import { contextBridge, ipcRenderer } from 'electron';

/**
 * Safe API exposed to the renderer process via contextBridge.
 *
 * The renderer never gets direct access to Node.js APIs or IPC channels.
 * All communication goes through this typed interface.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Snapshot
  onSnapshotUpdated: (callback: (summary: unknown) => void) => {
    ipcRenderer.on('snapshot:updated', (_event, summary) => callback(summary));
  },
  requestSnapshot: () => {
    ipcRenderer.send('snapshot:request');
  },
  onSnapshotReply: (callback: (summary: unknown) => void) => {
    ipcRenderer.on('snapshot:reply', (_event, summary) => callback(summary));
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
    ipcRenderer.on('config:reply', (_event, data) => callback(data));
  },
  updateConfig: (providerId: string, apiKey: string) => {
    ipcRenderer.send('config:update', { provider_id: providerId, api_key: apiKey });
  },
});
