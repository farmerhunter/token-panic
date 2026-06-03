import { ipcMain, BrowserWindow, shell, app } from 'electron';
import type { Store } from '../storage/store';
import type { CredentialStore } from '../credentials/credential-store';
import { generateSummary } from '../domain/summary';
import { validateSnapshot, createManualLimitSnapshot } from '../domain/normalize';
import type { ManualLimitInput } from '../domain/normalize';
import { getScheduler } from './scheduler';
import { findSafariAnalyticsTab, probeSafariJavaScript, readSafariTabText, classifySafariError } from './safari-capture';
import { exportDebugBundle, logDiagnosticEvent } from './diagnostics';
import type { DebugBundleRequest } from '../shared/diagnostics';

export interface IpcContext {
  store: Store;
  credentialStore: CredentialStore;
  getPanelWindow: () => BrowserWindow | null;
}

function push(win: BrowserWindow | null, channel: string, data: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

export function registerIpcHandlers(ctx: IpcContext): void {
  // ---- Snapshot ----

  ipcMain.on('snapshot:request', async () => {
    // Reply for each known provider so renderer hooks filter by provider_id
    for (const pid of ['deepseek', 'chatgpt']) {
      const snapshot = await ctx.store.getSnapshot(pid);
      const summary = generateSummary(snapshot);
      push(ctx.getPanelWindow(), 'snapshot:reply', summary);
    }
  });

  // ---- Refresh ----

  ipcMain.on('refresh:trigger', async (_event, providerId: string) => {
    const scheduler = getScheduler();
    await scheduler.triggerNow(providerId);
  });

  // ---- Config ----

  ipcMain.on('config:get', async () => {
    const hasKey = (await ctx.credentialStore.get('deepseek')) !== null;
    push(ctx.getPanelWindow(), 'config:reply', {
      provider_id: 'deepseek',
      has_key: hasKey,
    });
  });

  ipcMain.on('config:update', async (_event, data: { provider_id: string; api_key: string }) => {
    const scheduler = getScheduler();

    if (data.api_key) {
      await ctx.credentialStore.set(data.provider_id, data.api_key);
      scheduler.setApiKey(data.provider_id, data.api_key);
    } else {
      await ctx.credentialStore.delete(data.provider_id);
      scheduler.setApiKey(data.provider_id, null);
    }

    await scheduler.triggerNow(data.provider_id);
  });

  // ---- Phase 3: Manual snapshot (write-event pipeline, DD-016) ----

  ipcMain.on('manual-snapshot:update', async (_event, input: ManualLimitInput) => {
    try {
      const snapshot = createManualLimitSnapshot(input);
      const validationError = validateSnapshot(snapshot);
      if (validationError) {
        push(ctx.getPanelWindow(), 'manual-snapshot:saved', {
          error: validationError,
        });
        return;
      }

      // Save to storage
      await ctx.store.saveSnapshot(snapshot);

      // Append to history (for future burn rate support for limit models)
      // Limit window is not the same as balance, so history is less meaningful,
      // but we record it for possible future use.
      // We don't have remaining_amount for limit models, skip for now.

      // Generate summary
      const summary = generateSummary(snapshot);
      push(ctx.getPanelWindow(), 'snapshot:updated', summary);
      push(ctx.getPanelWindow(), 'manual-snapshot:saved', { success: true });
    } catch (err: any) {
      push(ctx.getPanelWindow(), 'manual-snapshot:saved', {
        error: err.message,
      });
    }
  });

  // ---- Phase 3: Safari capture ----

  ipcMain.on('safari-capture:find', async () => {
    try {
      const tab = await findSafariAnalyticsTab();
      push(ctx.getPanelWindow(), 'safari-capture:tab-found', tab);
    } catch (err: any) {
      push(ctx.getPanelWindow(), 'safari-capture:error', {
        phase: 'find',
        type: classifySafariError(err),
        message: err.message,
      });
    }
  });

  ipcMain.on('safari-capture:probe', async () => {
    const result = await probeSafariJavaScript();
    push(ctx.getPanelWindow(), 'safari-capture:probe-result', result);
  });

  ipcMain.on('safari-capture:read', async () => {
    try {
      const result = await readSafariTabText();
      // Bring panel back after Safari read — use app.focus for reliability
      const win = ctx.getPanelWindow();
      if (win && !win.isDestroyed()) {
        setTimeout(() => {
          if (!win.isDestroyed()) {
            win.show();
            app.focus({ steal: true });
          }
        }, 300); // small delay lets Safari's AppleScript finish
      }
      if (result) {
        push(win, 'safari-capture:text-read', result);
      } else {
        push(win, 'safari-capture:error', {
          phase: 'read',
          type: 'read_failed',
          message: '无法读取 Safari 页面文本',
        });
      }
    } catch (err: any) {
      console.error('[safari-capture] read error:', err.message);
      push(ctx.getPanelWindow(), 'safari-capture:error', {
        phase: 'read',
        type: classifySafariError(err),
        message: err.message,
      });
    }
  });

  ipcMain.on('diagnostics:export', async (_event, request: DebugBundleRequest) => {
    const result = exportDebugBundle(request);
    push(ctx.getPanelWindow(), 'diagnostics:exported', result);
  });

  ipcMain.on('diagnostics:reveal', async (_event, bundlePath: string) => {
    if (bundlePath) {
      shell.showItemInFolder(bundlePath);
    }
  });

  ipcMain.on('diagnostics:parser', async (_event, data: { trace_id: string; status: 'ok' | 'error'; metadata?: Record<string, unknown>; error?: { type: string; message: string } }) => {
    logDiagnosticEvent({
      trace_id: data.trace_id,
      component: 'text_parser',
      phase: 'parse_text',
      status: data.status,
      metadata: data.metadata,
      error: data.error,
    });
  });
}
