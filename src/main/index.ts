import { app } from 'electron';
import { createTray } from './tray';
import { registerIpcHandlers } from './ipc-handlers';
import { getScheduler } from './scheduler';
import { Store } from '../storage/store';
import { FileCredentialStore } from '../credentials/credential-store';
import { deepseekAdapter } from '../adapters/deepseek';
import { generateSummary } from '../domain/summary';
import { validateSnapshot } from '../domain/normalize';
import { processHistory } from '../domain/history';
import { calculateBurnRate } from '../domain/burn-rate';
import { estimateRemaining } from '../domain/estimated-remaining';
import type { BalancePayload } from '../shared/types';

// ---- Bootstrap ----

let mainWindow: Electron.BrowserWindow | null = null;

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  const store = new Store(userDataPath);
  const credentialStore = new FileCredentialStore(userDataPath);

  // Create tray and panel window
  const { tray, panelWindow } = createTray();
  mainWindow = panelWindow;

  // Wire up IPC handlers
  registerIpcHandlers({
    store,
    credentialStore,
    getPanelWindow: () => panelWindow,
  });

  // Start scheduler for DeepSeek
  const scheduler = getScheduler();
  scheduler.register(deepseekAdapter, async (adapter, ctx) => {
    const result = await adapter.fetchSnapshot(ctx);
    if (result.snapshot) {
      // Validate
      const validationError = validateSnapshot(result.snapshot);
      if (validationError) {
        console.error(`Snapshot validation failed for ${adapter.id}: ${validationError}`);
        result.snapshot.status = 'error';
        result.snapshot.status_reason = validationError;
      }
    }

    // Get last success for fallback
    const lastSuccess = await store.getSnapshot(adapter.id);

    // Save current snapshot if OK, and append to history
    if (result.snapshot && result.snapshot.status === 'ok') {
      await store.saveSnapshot(result.snapshot);

      // Phase 2: append to history for burn rate calculation
      const payload = result.snapshot.payload as BalancePayload;
      await store.appendHistory(adapter.id, {
        captured_at: result.snapshot.captured_at,
        remaining_amount: payload.remaining_amount,
        currency: payload.currency,
      });

      // Load full history, process, compute burn rate + estimated remaining
      const history = await store.getHistory(adapter.id);
      const processed = processHistory(history);
      const burnRate = calculateBurnRate(processed);
      const estimated = burnRate
        ? estimateRemaining(payload.remaining_amount, burnRate)
        : null;

      // Generate summary with burn rate data
      const summaryWithMetrics = generateSummary(
        result.snapshot,
        lastSuccess,
        burnRate,
        estimated,
      );

      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.webContents.send('snapshot:updated', summaryWithMetrics);
      }

      return result;
    }

    // For non-ok results, generate summary without burn rate
    const summary = generateSummary(result.snapshot, lastSuccess);

    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send('snapshot:updated', summary);
    }

    return result;
  });

  // Load API key and kick off initial fetch
  credentialStore.get('deepseek').then((apiKey) => {
    if (apiKey) {
      scheduler.setApiKey('deepseek', apiKey);
    }
    scheduler.triggerNow(deepseekAdapter.id);
  });

  // Load preferences and start auto-refresh if enabled
  store.getPreferences().then((prefs) => {
    if (prefs.auto_refresh) {
      scheduler.startAll();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, menu bar apps stay running even when windows close
});

app.on('activate', () => {
  // Re-show panel when dock icon clicked (macOS)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
});
