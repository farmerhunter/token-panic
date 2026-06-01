import { ipcMain, BrowserWindow } from 'electron';
import type { Store } from '../storage/store';
import type { CredentialStore } from '../credentials/credential-store';
import { generateSummary } from '../domain/summary';
import { getScheduler } from './scheduler';

export interface IpcContext {
  store: Store;
  credentialStore: CredentialStore;
  getPanelWindow: () => BrowserWindow | null;
}

export function registerIpcHandlers(ctx: IpcContext): void {
  // ---- Snapshot ----

  ipcMain.on('snapshot:request', async () => {
    const snapshot = await ctx.store.getSnapshot('deepseek');
    const summary = generateSummary(snapshot);
    const win = ctx.getPanelWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('snapshot:reply', summary);
    }
  });

  // ---- Refresh ----

  ipcMain.on('refresh:trigger', async (_event, providerId: string) => {
    const scheduler = getScheduler();
    await scheduler.triggerNow(providerId);
    // The callback registered in index.ts handles saving + pushing to renderer
  });

  // ---- Config ----

  ipcMain.on('config:get', async () => {
    const hasKey = (await ctx.credentialStore.get('deepseek')) !== null;
    const win = ctx.getPanelWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('config:reply', {
        provider_id: 'deepseek',
        has_key: hasKey,
      });
    }
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

    // Trigger a refresh with the new credentials
    await scheduler.triggerNow(data.provider_id);
  });
}
