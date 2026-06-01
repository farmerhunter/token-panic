import { describe, it, expect } from 'vitest';
import type {
  ProviderSnapshot,
  BalancePayload,
  LimitPayload,
  UsagePayload,
  CostPayload,
  ProviderSummary,
  FetchResult,
  StoredData,
} from './types';

describe('Type structures (runtime validation)', () => {
  it('should construct a valid BalancePayload', () => {
    const payload: BalancePayload = {
      remaining_amount: 42.5,
      currency: 'CNY',
      period: {
        key: 'month',
        used_tokens: 380000,
      },
    };
    expect(payload.remaining_amount).toBe(42.5);
    expect(payload.currency).toBe('CNY');
    expect(payload.period?.key).toBe('month');
  });

  it('should construct a valid LimitPayload', () => {
    const payload: LimitPayload = {
      limits: [
        {
          window: '5h',
          used: 1_200_000,
          total: 2_000_000,
          unit: 'tokens',
          resets_at: '2026-06-01T14:00:00Z',
        },
      ],
    };
    expect(payload.limits).toHaveLength(1);
    expect(payload.limits[0].window).toBe('5h');
    expect(payload.limits[0].used).toBe(1_200_000);
  });

  it('should construct a valid UsagePayload', () => {
    const payload: UsagePayload = {
      periods: [
        { key: 'day', used_tokens: 120000 },
      ],
    };
    expect(payload.periods[0].key).toBe('day');
  });

  it('should construct a valid CostPayload', () => {
    const payload: CostPayload = {
      periods: [
        {
          key: 'day',
          spend_amount: 0.84,
          currency: 'USD',
        },
      ],
    };
    expect(payload.periods[0].spend_amount).toBe(0.84);
  });

  it('should construct a valid ProviderSnapshot with BalancePayload', () => {
    const snapshot: ProviderSnapshot = {
      provider_id: 'deepseek',
      provider_name: 'DeepSeek',
      source: 'official_api',
      quota_model: 'balance',
      captured_at: '2026-06-01T10:00:00Z',
      status: 'ok',
      payload: {
        remaining_amount: 42.5,
        currency: 'CNY',
      },
    };
    expect(snapshot.provider_id).toBe('deepseek');
    expect(snapshot.status).toBe('ok');
    expect(snapshot.quota_model).toBe('balance');
  });

  it('should construct a valid ProviderSummary', () => {
    const summary: ProviderSummary = {
      provider_id: 'deepseek',
      display_name: 'DeepSeek',
      status: 'ok',
      quota_model: 'balance',
      source: 'official_api',
      primary_metric: '¥42.50 剩余',
      secondary_metric: '本月 380K tokens',
      last_fetch: '2026-06-01T10:00:00Z',
    };
    expect(summary.primary_metric).toContain('¥');
    expect(summary.last_fetch).toBeTruthy();
  });

  it('should construct FetchResult for success and error cases', () => {
    const success: FetchResult = {
      snapshot: {
        provider_id: 'deepseek',
        provider_name: 'DeepSeek',
        source: 'official_api',
        quota_model: 'balance',
        captured_at: '2026-06-01T10:00:00Z',
        status: 'ok',
        payload: { remaining_amount: 42.5, currency: 'CNY' },
      },
    };
    expect(success.snapshot).not.toBeNull();
    expect(success.error).toBeUndefined();

    const failure: FetchResult = {
      snapshot: null,
      error: { status: 'auth_required', reason: 'Invalid API key' },
    };
    expect(failure.snapshot).toBeNull();
    expect(failure.error?.status).toBe('auth_required');
  });

  it('should construct a valid StoredData structure', () => {
    const data: StoredData = {
      schema_version: 1,
      snapshots: {},
      preferences: {
        auto_refresh: true,
        default_refresh_interval_min: 30,
      },
    };
    expect(data.schema_version).toBe(1);
    expect(data.preferences.auto_refresh).toBe(true);
  });
});
