import type {
  ProviderSnapshot,
  ProviderSource,
  QuotaModel,
  BalancePayload,
  LimitPayload,
  UsagePayload,
  CostPayload,
  ProviderStatus,
} from '../shared/types';

// ---- Snapshot envelope constructor ----

export interface SnapshotParams {
  provider_id: string;
  provider_name: string;
  source: ProviderSource;
  quota_model: QuotaModel;
  payload: BalancePayload | LimitPayload | UsagePayload | CostPayload;
  status?: ProviderStatus;
  status_reason?: string;
  plan?: string;
  capture_method?: string;
}

export function createSnapshot(params: SnapshotParams): ProviderSnapshot {
  return {
    provider_id: params.provider_id,
    provider_name: params.provider_name,
    source: params.source,
    quota_model: params.quota_model,
    captured_at: new Date().toISOString(),
    status: params.status ?? 'ok',
    status_reason: params.status_reason,
    plan: params.plan,
    capture_method: params.capture_method,
    payload: params.payload,
  };
}

// ---- Balance payload constructor ----

export interface BalanceParams {
  remaining_amount: number;
  currency: string;
  period?: {
    key: 'day' | 'week' | 'month';
    used_tokens?: number;
    spend_amount?: number;
    request_count?: number;
  };
}

export function createBalancePayload(params: BalanceParams): BalancePayload {
  const payload: BalancePayload = {
    remaining_amount: params.remaining_amount,
    currency: params.currency,
  };
  if (params.period) {
    payload.period = {
      key: params.period.key,
      used_tokens: params.period.used_tokens,
      spend_amount: params.period.spend_amount,
      request_count: params.period.request_count,
    };
  }
  return payload;
}

// ---- Validators ----

export function validateSnapshot(snapshot: ProviderSnapshot): string | null {
  if (!snapshot.provider_id || typeof snapshot.provider_id !== 'string') {
    return 'provider_id is required and must be a string';
  }
  if (!snapshot.provider_name || typeof snapshot.provider_name !== 'string') {
    return 'provider_name is required and must be a string';
  }
  if (!snapshot.captured_at || isNaN(Date.parse(snapshot.captured_at))) {
    return 'captured_at must be a valid ISO 8601 date string';
  }
  if (!['ok', 'stale', 'error', 'auth_required', 'manual_required', 'disabled'].includes(snapshot.status)) {
    return `invalid status: ${snapshot.status}`;
  }
  if (!snapshot.payload || typeof snapshot.payload !== 'object') {
    return 'payload is required';
  }

  // Validate payload per quota_model
  switch (snapshot.quota_model) {
    case 'balance': {
      const p = snapshot.payload as BalancePayload;
      if (typeof p.remaining_amount !== 'number' || p.remaining_amount < 0) {
        return 'balance payload: remaining_amount must be a non-negative number';
      }
      if (!p.currency || typeof p.currency !== 'string') {
        return 'balance payload: currency is required';
      }
      break;
    }
    case 'limit': {
      const p = snapshot.payload as LimitPayload;
      if (!Array.isArray(p.limits) || p.limits.length === 0) {
        return 'limit payload: limits must be a non-empty array';
      }
      for (const limit of p.limits) {
        if (typeof limit.used !== 'number' || limit.used < 0) {
          return 'limit payload: each limit.used must be a non-negative number';
        }
        if (typeof limit.total !== 'number' || limit.total <= 0) {
          return 'limit payload: each limit.total must be a positive number';
        }
      }
      break;
    }
    case 'usage': {
      const p = snapshot.payload as UsagePayload;
      if (!Array.isArray(p.periods) || p.periods.length === 0) {
        return 'usage payload: periods must be a non-empty array';
      }
      break;
    }
    case 'cost': {
      const p = snapshot.payload as CostPayload;
      if (!Array.isArray(p.periods) || p.periods.length === 0) {
        return 'cost payload: periods must be a non-empty array';
      }
      for (const period of p.periods) {
        if (typeof period.spend_amount !== 'number' || period.spend_amount < 0) {
          return 'cost payload: each period.spend_amount must be a non-negative number';
        }
      }
      break;
    }
  }

  return null; // valid
}

// ---- Manual limit snapshot (Phase 3) ----

export interface ManualLimitInput {
  provider_id: string;
  provider_name: string;
  plan?: string;
  capture_method?: string;
  limits: Array<{
    window: string;
    used: number;
    total: number;
    unit: string;
    remaining?: number;
    resets_at?: string;
  }>;
}

/**
 * Create a ProviderSnapshot from user-entered manual limit data.
 * Used by the manual-snapshot:update IPC handler — does not go through adapter/scheduler.
 * See DD-016.
 */
export function createManualLimitSnapshot(input: ManualLimitInput): ProviderSnapshot {
  // Validate used <= total for each limit
  for (const limit of input.limits) {
    if (limit.used > limit.total) {
      throw new Error(
        `Invalid limit: used (${limit.used}) exceeds total (${limit.total}) for window "${limit.window}"`,
      );
    }
    if (limit.used < 0 || limit.total <= 0) {
      throw new Error(
        `Invalid limit values for window "${limit.window}": used=${limit.used}, total=${limit.total}`,
      );
    }
  }

  const payload: LimitPayload = {
    limits: input.limits.map((l) => ({
      window: l.window,
      used: l.used,
      total: l.total,
      unit: l.unit,
      remaining: l.remaining,
      resets_at: l.resets_at,
    })),
  };

  return createSnapshot({
    provider_id: input.provider_id,
    provider_name: input.provider_name,
    source: 'manual',
    quota_model: 'limit',
    payload,
    plan: input.plan,
    capture_method: input.capture_method,
  });
}
