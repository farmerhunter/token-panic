import type { ProviderSummary, ConfigData } from '@shared/types';
import type { SafariTabInfo, CaptureResult, ProbeResult } from '../main/safari-capture';
import type { ManualLimitInput } from '../domain/normalize';
import type { DebugBundleRequest, DebugBundleResult } from '../shared/diagnostics';

type Unsubscribe = () => void;

export interface ElectronAPI {
  // Existing
  onSnapshotUpdated: (callback: (summary: ProviderSummary) => void) => Unsubscribe;
  requestSnapshot: () => void;
  onSnapshotReply: (callback: (summary: ProviderSummary) => void) => Unsubscribe;
  triggerRefresh: (providerId: string) => void;
  requestConfig: () => void;
  onConfigReply: (callback: (data: ConfigData) => void) => Unsubscribe;
  updateConfig: (providerId: string, apiKey: string) => void;

  // Phase 3 — Manual snapshot
  saveManualSnapshot: (input: ManualLimitInput) => void;
  onManualSnapshotSaved: (callback: (result: { success?: boolean; error?: string }) => void) => Unsubscribe;

  // Phase 3 — Safari capture
  findSafariTab: () => void;
  onSafariTabFound: (callback: (tab: SafariTabInfo | null) => void) => Unsubscribe;
  probeSafariJS: () => void;
  onSafariProbeResult: (callback: (result: ProbeResult) => void) => Unsubscribe;
  readSafariTab: () => void;
  onSafariTextRead: (callback: (result: CaptureResult) => void) => Unsubscribe;
  onSafariCaptureError: (callback: (error: { phase: string; type: string; message: string }) => void) => Unsubscribe;

  // Panel lifecycle (P2-K)
  onPanelShown: (callback: () => void) => Unsubscribe;
  onOpenSettingsRequested: (callback: () => void) => Unsubscribe;

  // Phase 6B — Login Item
  getStartupSettings: () => void;
  setStartupSettings: (openAtLogin: boolean) => void;
  onStartupReply: (callback: (data: { openAtLogin: boolean; supported: boolean }) => void) => Unsubscribe;

  // Diagnostics
  recordParserDiagnostics: (data: unknown) => void;
  exportDebugBundle: (request: DebugBundleRequest) => void;
  onDebugBundleExported: (callback: (result: DebugBundleResult) => void) => Unsubscribe;
  revealDebugBundle: (bundlePath: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
