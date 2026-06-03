import { describe, it, expect } from 'vitest';
import {
  createSnapshot,
  createBalancePayload,
  validateSnapshot,
} from './normalize';
import type { ProviderSnapshot, BalancePayload, LimitPayload } from '../shared/types';

describe('createBalancePayload', () => {
  it('should create a minimal balance payload', () => {
    const payload = createBalancePayload({ remaining_amount: 42.5, currency: 'CNY' });
    expect(payload.remaining_amount).toBe(42.5);
    expect(payload.currency).toBe('CNY');
    expect(payload.period).toBeUndefined();
  });

  it('should create a balance payload with period info', () => {
    const payload = createBalancePayload({
      remaining_amount: 100,
      currency: 'USD',
      period: { key: 'month', used_tokens: 500000, spend_amount: 3.5 },
    });
    expect(payload.period?.key).toBe('month');
    expect(payload.period?.used_tokens).toBe(500000);
    expect(payload.period?.spend_amount).toBe(3.5);
  });
});

describe('createSnapshot', () => {
  it('should create a valid snapshot for a balance provider', () => {
    const payload = createBalancePayload({ remaining_amount: 42.5, currency: 'CNY' });
    const snapshot = createSnapshot({
      provider_id: 'deepseek',
      provider_name: 'DeepSeek',
      source: 'official_api',
      quota_model: 'balance',
      payload,
    });

    expect(snapshot.provider_id).toBe('deepseek');
    expect(snapshot.source).toBe('official_api');
    expect(snapshot.quota_model).toBe('balance');
    expect(snapshot.status).toBe('ok');
    expect(snapshot.captured_at).toBeTruthy();
    expect(Date.parse(snapshot.captured_at)).not.toBeNaN();
  });

  it('should allow overriding status and reason', () => {
    const payload = createBalancePayload({ remaining_amount: 0, currency: 'CNY' });
    const snapshot = createSnapshot({
      provider_id: 'deepseek',
      provider_name: 'DeepSeek',
      source: 'official_api',
      quota_model: 'balance',
      payload,
      status: 'error',
      status_reason: 'Network timeout',
    });

    expect(snapshot.status).toBe('error');
    expect(snapshot.status_reason).toBe('Network timeout');
  });
});

describe('validateSnapshot', () => {
  function makeBalanceSnapshot(overrides?: Partial<ProviderSnapshot>): ProviderSnapshot {
    const payload: BalancePayload = { remaining_amount: 42.5, currency: 'CNY' };
    return {
      provider_id: 'test',
      provider_name: 'Test Provider',
      source: 'official_api',
      quota_model: 'balance',
      captured_at: '2026-06-01T10:00:00Z',
      status: 'ok',
      payload,
      ...overrides,
    };
  }

  it('should return null for a valid balance snapshot', () => {
    expect(validateSnapshot(makeBalanceSnapshot())).toBeNull();
  });

  it('should reject missing provider_id', () => {
    const err = validateSnapshot(makeBalanceSnapshot({ provider_id: '' }));
    expect(err).toContain('provider_id');
  });

  it('should reject invalid captured_at', () => {
    const err = validateSnapshot(makeBalanceSnapshot({ captured_at: 'not-a-date' }));
    expect(err).toContain('captured_at');
  });

  it('should reject invalid status', () => {
    const err = validateSnapshot(makeBalanceSnapshot({ status: 'unknown' as any }));
    expect(err).toContain('invalid status');
  });

  it('should reject negative remaining_amount', () => {
    const snapshot = makeBalanceSnapshot();
    (snapshot.payload as BalancePayload).remaining_amount = -5;
    const err = validateSnapshot(snapshot);
    expect(err).toContain('remaining_amount');
  });

  it('should reject missing currency', () => {
    const snapshot = makeBalanceSnapshot();
    (snapshot.payload as BalancePayload).currency = '';
    const err = validateSnapshot(snapshot);
    expect(err).toContain('currency');
  });

  it('should validate limit payload', () => {
    const limitPayload: LimitPayload = {
      limits: [{ window: 'day', used: 100, total: 1000, unit: 'tokens' }],
    };
    const snapshot: ProviderSnapshot = {
      provider_id: 'test',
      provider_name: 'Test',
      source: 'browser_scrape',
      quota_model: 'limit',
      captured_at: '2026-06-01T10:00:00Z',
      status: 'ok',
      payload: limitPayload,
    };
    expect(validateSnapshot(snapshot)).toBeNull();
  });

  it('should reject limit payload with negative used', () => {
    const limitPayload: LimitPayload = {
      limits: [{ window: 'day', used: -1, total: 1000, unit: 'tokens' }],
    };
    const snapshot: ProviderSnapshot = {
      provider_id: 'test',
      provider_name: 'Test',
      source: 'browser_scrape',
      quota_model: 'limit',
      captured_at: '2026-06-01T10:00:00Z',
      status: 'ok',
      payload: limitPayload,
    };
    const err = validateSnapshot(snapshot);
    expect(err).toContain('limit.used');
  });

  it('should accept manual_required status', () => {
    const snapshot = makeBalanceSnapshot();
    const modified = { ...snapshot, status: 'manual_required' as const };
    expect(validateSnapshot(modified)).toBeNull();
  });
});

// ---- createManualLimitSnapshot (Phase 3) ----

import { createManualLimitSnapshot } from './normalize';

describe('createManualLimitSnapshot', () => {
  it('should create a valid limit snapshot from manual input', () => {
    const snapshot = createManualLimitSnapshot({
      provider_id: 'chatgpt',
      provider_name: 'ChatGPT',
      plan: 'ChatGPT Plus',
      limits: [
        { window: '5h', used: 1_200_000, total: 2_000_000, unit: 'tokens' },
        { window: 'week', used: 3_800_000, total: 10_000_000, unit: 'tokens' },
      ],
    });

    expect(snapshot.provider_id).toBe('chatgpt');
    expect(snapshot.source).toBe('manual');
    expect(snapshot.quota_model).toBe('limit');
    expect(snapshot.status).toBe('ok');
    expect(snapshot.plan).toBe('ChatGPT Plus');

    const payload = snapshot.payload as any;
    expect(payload.limits).toHaveLength(2);
    expect(payload.limits[0].window).toBe('5h');
    expect(payload.limits[0].used).toBe(1_200_000);
    expect(payload.limits[1].window).toBe('week');
  });

  it('should pass validateSnapshot', () => {
    const snapshot = createManualLimitSnapshot({
      provider_id: 'chatgpt',
      provider_name: 'ChatGPT',
      limits: [
        { window: '5h', used: 100, total: 500, unit: 'messages' },
      ],
    });
    expect(validateSnapshot(snapshot)).toBeNull();
  });

  it('should throw when used exceeds total', () => {
    expect(() =>
      createManualLimitSnapshot({
        provider_id: 'chatgpt',
        provider_name: 'ChatGPT',
        limits: [{ window: '5h', used: 999, total: 100, unit: 'tokens' }],
      }),
    ).toThrow('exceeds total');
  });

  it('should throw on negative values', () => {
    expect(() =>
      createManualLimitSnapshot({
        provider_id: 'chatgpt',
        provider_name: 'ChatGPT',
        limits: [{ window: '5h', used: -1, total: 100, unit: 'tokens' }],
      }),
    ).toThrow();
  });

  it('should include optional resets_at', () => {
    const snapshot = createManualLimitSnapshot({
      provider_id: 'chatgpt',
      provider_name: 'ChatGPT',
      limits: [
        { window: '5h', used: 100, total: 500, unit: 'tokens', resets_at: '2026-06-02T14:00:00Z' },
      ],
    });
    const payload = snapshot.payload as any;
    expect(payload.limits[0].resets_at).toBe('2026-06-02T14:00:00Z');
  });
});
