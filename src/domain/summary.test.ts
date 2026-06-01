import { describe, it, expect } from 'vitest';
import { generateSummary } from './summary';
import { createSnapshot, createBalancePayload } from './normalize';
import type { ProviderSnapshot, BalancePayload, LimitPayload, UsagePayload, CostPayload } from '../shared/types';

// ---- helpers ----

function makeBalanceSnapshot(remaining = 42.5, currency = 'CNY', usedTokens?: number): ProviderSnapshot {
  const payload = createBalancePayload({
    remaining_amount: remaining,
    currency,
    period: usedTokens !== undefined
      ? { key: 'month', used_tokens: usedTokens }
      : undefined,
  });
  return createSnapshot({
    provider_id: 'deepseek',
    provider_name: 'DeepSeek',
    source: 'official_api',
    quota_model: 'balance',
    payload,
  });
}

// ---- balance ----

describe('generateSummary — balance', () => {
  it('should show remaining amount in CNY', () => {
    const summary = generateSummary(makeBalanceSnapshot(42.5, 'CNY'));
    expect(summary.primary_metric).toBe('¥42.50 剩余');
    expect(summary.status).toBe('ok');
    expect(summary.quota_model).toBe('balance');
  });

  it('should show remaining amount in USD', () => {
    const summary = generateSummary(makeBalanceSnapshot(10.0, 'USD'));
    expect(summary.primary_metric).toBe('$10.00 剩余');
  });

  it('should include period usage as secondary metric', () => {
    const summary = generateSummary(makeBalanceSnapshot(42.5, 'CNY', 380000));
    expect(summary.secondary_metric).toBe('本月 380K tokens');
  });

  it('should format large token counts', () => {
    const summary = generateSummary(makeBalanceSnapshot(100, 'CNY', 1_500_000));
    expect(summary.secondary_metric).toContain('1.5M tokens');
  });
});

// ---- limit ----

describe('generateSummary — limit', () => {
  it('should show window limits', () => {
    const limitPayload: LimitPayload = {
      limits: [
        { window: '5h', used: 1_200_000, total: 2_000_000, unit: 'tokens' },
        { window: 'week', used: 3_800_000, total: 10_000_000, unit: 'tokens' },
      ],
    };
    const snapshot = createSnapshot({
      provider_id: 'chatgpt',
      provider_name: 'ChatGPT',
      source: 'browser_scrape',
      quota_model: 'limit',
      payload: limitPayload,
    });
    const summary = generateSummary(snapshot);
    expect(summary.primary_metric).toBe('5h 1.2M/2.0M  week 3.8M/10.0M');
  });
});

// ---- usage ----

describe('generateSummary — usage', () => {
  it('should show daily token usage', () => {
    const usagePayload: UsagePayload = {
      periods: [{ key: 'day', used_tokens: 120000 }],
    };
    const snapshot = createSnapshot({
      provider_id: 'openai',
      provider_name: 'OpenAI Platform',
      source: 'official_api',
      quota_model: 'usage',
      payload: usagePayload,
    });
    const summary = generateSummary(snapshot);
    expect(summary.primary_metric).toBe('今日 120K tokens');
  });
});

// ---- cost ----

describe('generateSummary — cost', () => {
  it('should show daily spend', () => {
    const costPayload: CostPayload = {
      periods: [{ key: 'day', spend_amount: 0.84, currency: 'USD' }],
    };
    const snapshot = createSnapshot({
      provider_id: 'openai',
      provider_name: 'OpenAI Platform',
      source: 'official_api',
      quota_model: 'cost',
      payload: costPayload,
    });
    const summary = generateSummary(snapshot);
    expect(summary.primary_metric).toBe('今日 $0.84');
  });
});

// ---- error / fallback ----

describe('generateSummary — error with fallback', () => {
  it('should use last success snapshot data with error status', () => {
    const lastSuccess = makeBalanceSnapshot(42.5, 'CNY', 380000);

    const errorPayload = createBalancePayload({ remaining_amount: 0, currency: 'CNY' });
    const errorSnapshot = createSnapshot({
      provider_id: 'deepseek',
      provider_name: 'DeepSeek',
      source: 'official_api',
      quota_model: 'balance',
      payload: errorPayload,
      status: 'error',
      status_reason: 'Network timeout',
    });

    const summary = generateSummary(errorSnapshot, lastSuccess);
    expect(summary.status).toBe('error');
    expect(summary.primary_metric).toBe('¥42.50 剩余');
    expect(summary.secondary_metric).toContain('数据已过期');
  });

  it('should show auth_required status with stale data', () => {
    const lastSuccess = makeBalanceSnapshot(42.5, 'CNY');

    const authPayload = createBalancePayload({ remaining_amount: 0, currency: 'CNY' });
    const authSnapshot = createSnapshot({
      provider_id: 'deepseek',
      provider_name: 'DeepSeek',
      source: 'official_api',
      quota_model: 'balance',
      payload: authPayload,
      status: 'auth_required',
      status_reason: 'Invalid API key',
    });

    const summary = generateSummary(authSnapshot, lastSuccess);
    expect(summary.status).toBe('auth_required');
    expect(summary.primary_metric).toBe('¥42.50 剩余');
  });

  it('should handle no data at all', () => {
    const summary = generateSummary(null, null);
    expect(summary.primary_metric).toBe('无数据');
    expect(summary.status).toBe('error');
  });

  it('should handle null snapshot with valid fallback', () => {
    const lastSuccess = makeBalanceSnapshot(42.5, 'CNY');
    const summary = generateSummary(null, lastSuccess);
    expect(summary.primary_metric).toBe('¥42.50 剩余');
    expect(summary.last_fetch).toBe(lastSuccess.captured_at);
  });
});

// ---- disabled ----

describe('generateSummary — disabled', () => {
  it('should show disabled status', () => {
    const snapshot = makeBalanceSnapshot(42.5, 'CNY');
    // Override status manually since createSnapshot defaults to 'ok'
    const disabledSnapshot: ProviderSnapshot = { ...snapshot, status: 'disabled' };
    const summary = generateSummary(disabledSnapshot);
    expect(summary.status).toBe('disabled');
    expect(summary.primary_metric).toBe('¥42.50 剩余');
  });
});

// ---- formatTokens ----

describe('formatTokens (via secondary_metric)', () => {
  it('should format < 1000 as-is', () => {
    const summary = generateSummary(makeBalanceSnapshot(10, 'CNY', 500));
    expect(summary.secondary_metric).toContain('500 tokens');
  });

  it('should format thousands with K', () => {
    const summary = generateSummary(makeBalanceSnapshot(10, 'CNY', 120_000));
    expect(summary.secondary_metric).toContain('120K tokens');
  });

  it('should format millions with M', () => {
    const summary = generateSummary(makeBalanceSnapshot(10, 'CNY', 5_200_000));
    expect(summary.secondary_metric).toContain('5.2M tokens');
  });
});
