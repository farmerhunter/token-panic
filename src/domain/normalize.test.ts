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
});
