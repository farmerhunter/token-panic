import { contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

function on(channel: string, callback: (data: unknown) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/**
 * Safe API exposed to the renderer process via contextBridge.
 *
 * The renderer never gets direct access to Node.js APIs or IPC channels.
 * All communication goes through this typed interface.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Snapshot
  onSnapshotUpdated: (callback: (summary: unknown) => void) => {
    return on('snapshot:updated', callback);
  },
  requestSnapshot: () => {
    ipcRenderer.send('snapshot:request');
  },
  onSnapshotReply: (callback: (summary: unknown) => void) => {
    return on('snapshot:reply', callback);
  },

  // Refresh
  triggerRefresh: (providerId: string) => {
    ipcRenderer.send('refresh:trigger', providerId);
  },

  // Config
  requestConfig: () => {
    ipcRenderer.send('config:get');
  },
  onConfigReply: (callback: (data: unknown) => void) => {
    return on('config:reply', callback);
  },
  updateConfig: (providerId: string, apiKey: string) => {
    ipcRenderer.send('config:update', { provider_id: providerId, api_key: apiKey });
  },

  // Phase 3 — Manual snapshot
  saveManualSnapshot: (input: unknown) => {
    ipcRenderer.send('manual-snapshot:update', input);
  },
  onManualSnapshotSaved: (callback: (summary: unknown) => void) => {
    return on('manual-snapshot:saved', callback);
  },

  // Phase 3 — Safari capture
  findSafariTab: () => {
    ipcRenderer.send('safari-capture:find');
  },
  onSafariTabFound: (callback: (tab: unknown) => void) => {
    return on('safari-capture:tab-found', callback);
  },
  probeSafariJS: () => {
    ipcRenderer.send('safari-capture:probe');
  },
  onSafariProbeResult: (callback: (result: unknown) => void) => {
    return on('safari-capture:probe-result', callback);
  },
  readSafariTab: () => {
    ipcRenderer.send('safari-capture:read');
  },
  onSafariTextRead: (callback: (result: unknown) => void) => {
    return on('safari-capture:text-read', callback);
  },
  onSafariCaptureError: (callback: (error: unknown) => void) => {
    return on('safari-capture:error', callback);
  },

  // Phase 6B — Login Item
  getStartupSettings: () => {
    ipcRenderer.send('startup:get');
  },
  setStartupSettings: (openAtLogin: boolean) => {
    ipcRenderer.send('startup:update', { openAtLogin });
  },
  onStartupReply: (callback: (data: unknown) => void) => {
    return on('startup:reply', callback);
  },

  // Panel lifecycle
  onPanelShown: (callback: () => void) => {
    return on('panel:shown', callback);
  },
  onOpenSettingsRequested: (callback: () => void) => {
    return on('panel:open-settings', callback);
  },

  // Diagnostics
  recordParserDiagnostics: (data: unknown) => {
    ipcRenderer.send('diagnostics:parser', data);
  },
  exportDebugBundle: (request: unknown) => {
    ipcRenderer.send('diagnostics:export', request);
  },
  onDebugBundleExported: (callback: (result: unknown) => void) => {
    return on('diagnostics:exported', callback);
  },
  revealDebugBundle: (bundlePath: string) => {
    ipcRenderer.send('diagnostics:reveal', bundlePath);
  },
});
