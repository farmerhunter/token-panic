import type { ProviderSummary, ConfigData } from '@shared/types';

export interface ElectronAPI {
  onSnapshotUpdated: (callback: (summary: ProviderSummary) => void) => void;
  requestSnapshot: () => void;
  onSnapshotReply: (callback: (summary: ProviderSummary) => void) => void;
  triggerRefresh: (providerId: string) => void;
  requestConfig: () => void;
  onConfigReply: (callback: (data: ConfigData) => void) => void;
  updateConfig: (providerId: string, apiKey: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
