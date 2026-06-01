// ============================================================
// Domain Types — shared between main process and renderer
// ============================================================

export type ProviderSource =
  | 'official_api'
  | 'browser_scrape'
  | 'custom_parser'
  | 'manual';

export type ProviderStatus =
  | 'ok'
  | 'stale'
  | 'error'
  | 'auth_required'
  | 'disabled';

export type QuotaModel = 'balance' | 'limit' | 'usage' | 'cost';

// ---- Payloads (discriminated by quota_model) ----

export interface BalancePayload {
  remaining_amount: number;
  currency: 'CNY' | 'USD' | string;
  period?: {
    key: 'day' | 'week' | 'month';
    used_tokens?: number;
    spend_amount?: number;
    request_count?: number;
    starts_at?: string;
    ends_at?: string;
  };
}

export interface LimitPayload {
  limits: Array<{
    window: '5h' | 'day' | 'week' | 'month' | string;
    used: number;
    total: number;
    unit: 'tokens' | 'messages' | 'requests' | string;
    resets_at?: string;
  }>;
}

export interface UsagePayload {
  periods: Array<{
    key: 'day' | 'week' | 'month';
    used_tokens?: number;
    request_count?: number;
    starts_at?: string;
    ends_at?: string;
  }>;
}

export interface CostPayload {
  periods: Array<{
    key: 'day' | 'week' | 'month';
    spend_amount: number;
    currency: 'CNY' | 'USD' | string;
    starts_at?: string;
    ends_at?: string;
  }>;
}

export type QuotaPayload =
  | BalancePayload
  | LimitPayload
  | UsagePayload
  | CostPayload;

// ---- Snapshot — the normalized output of any adapter ----

export interface ProviderSnapshot {
  provider_id: string;
  provider_name: string;
  source: ProviderSource;
  quota_model: QuotaModel;
  captured_at: string; // ISO 8601
  status: ProviderStatus;
  status_reason?: string;
  plan?: string;
  payload: QuotaPayload;
}

// ---- Derived metrics — produced by Core Domain ----

export interface BurnRate {
  value: number;
  unit: 'tokens/hour' | 'cost/day' | 'requests/hour' | string;
  confidence: 'high' | 'medium' | 'low';
}

export interface EstimatedRemaining {
  value: number;
  unit: 'minutes' | 'hours' | 'days';
  confidence: 'high' | 'medium' | 'low';
}

// ---- Summary — what the UI consumes ----

export interface ProviderSummary {
  provider_id: string;
  display_name: string;
  status: ProviderStatus;
  quota_model: QuotaModel;
  source: ProviderSource;
  primary_metric: string;
  secondary_metric?: string;
  burn_rate?: BurnRate;
  estimated_remaining?: EstimatedRemaining;
  last_fetch: string; // ISO 8601
}

// ---- Adapter interface ----

export interface AdapterContext {
  apiKey?: string;
  storageState?: string; // path to browser storageState for browser_scrape adapters
}

export interface FetchResult {
  snapshot: ProviderSnapshot | null;
  error?: {
    status: ProviderStatus;
    reason: string;
  };
}

export interface ProviderAdapter {
  id: string;
  name: string;
  source: ProviderSource;
  quota_model: QuotaModel;
  refresh_interval_min: number;
  fetchSnapshot(context: AdapterContext): Promise<FetchResult>;
}

// ---- IPC channel types ----

export type IpcChannel =
  | 'snapshot:updated'
  | 'snapshot:request'
  | 'snapshot:reply'
  | 'refresh:trigger'
  | 'config:get'
  | 'config:reply'
  | 'config:update';

export interface ConfigData {
  provider_id: string;
  has_key: boolean;
}

export interface ConfigUpdate {
  provider_id: string;
  api_key: string;
}

// ---- Storage schema ----

export interface StoredPreferences {
  auto_refresh: boolean;
  default_refresh_interval_min: number;
}

export interface StoredData {
  schema_version: number;
  snapshots: Record<string, ProviderSnapshot>;
  preferences: StoredPreferences;
}
