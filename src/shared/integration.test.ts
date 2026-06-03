/**
 * Integration tests — full pipeline verification.
 * Covers adapter→normalize→summary→storage pipelines
 * AND the main-process callback pattern that wires them together.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Store } from '../storage/store';
import { createManualLimitSnapshot, validateSnapshot, createBalancePayload, createSnapshot } from '../domain/normalize';
import { generateSummary } from '../domain/summary';
import { parseLimitText } from '../domain/text-parser';
import { processHistory } from '../domain/history';
import { calculateBurnRate } from '../domain/burn-rate';
import { estimateRemaining } from '../domain/estimated-remaining';
import type { ProviderSummary, ProviderSnapshot, ProviderAdapter, QuotaModel, ProviderSource, BalancePayload, LimitPayload, CostPayload, UsagePayload } from '../shared/types';

function setupTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tp-integration-'));
}

// ============================================================
// Flow 1: Full DeepSeek pipeline (unchanged)
// ============================================================
describe('Flow: DeepSeek balance fetch', () => {
  let tmpDir: string; let store: Store;
  beforeEach(() => { tmpDir = setupTmpDir(); store = new Store(tmpDir); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should save snapshot, generate summary, and persist correctly', async () => {
    const payload = createBalancePayload({ remaining_amount: 53.68, currency: 'CNY' });
    const snapshot = createSnapshot({ provider_id: 'deepseek', provider_name: 'DeepSeek', source: 'official_api', quota_model: 'balance', payload });
    await store.saveSnapshot(snapshot);
    const loaded = await store.getSnapshot('deepseek');
    expect(loaded).not.toBeNull();
    expect((loaded!.payload as any).remaining_amount).toBe(53.68);
    const summary = generateSummary(snapshot);
    expect(summary.provider_id).toBe('deepseek');
    expect(summary.primary_metric).toBe('¥53.68 剩余');
    expect(summary.status).toBe('ok');
  });

  it('should not overwrite ChatGPT data when saving DeepSeek', async () => {
    const cg = createManualLimitSnapshot({ provider_id: 'chatgpt', provider_name: 'ChatGPT', limits: [{ window: '5h', used: 60, total: 100, unit: 'percent' }] });
    await store.saveSnapshot(cg);
    const payload = createBalancePayload({ remaining_amount: 50.71, currency: 'CNY' });
    const ds = createSnapshot({ provider_id: 'deepseek', provider_name: 'DeepSeek', source: 'official_api', quota_model: 'balance', payload });
    await store.saveSnapshot(ds);
    expect((await store.getSnapshot('deepseek'))!.payload as any).toBeDefined();
    expect((await store.getSnapshot('chatgpt'))!.payload as any).toBeDefined();
  });
});

// ============================================================
// Flow 2: ChatGPT Safari capture → manual snapshot (unchanged)
// ============================================================
describe('Flow: ChatGPT manual snapshot', () => {
  let tmpDir: string; let store: Store;
  beforeEach(() => { tmpDir = setupTmpDir(); store = new Store(tmpDir); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should create snapshot from Safari-captured + parsed text', () => {
    const capturedText = 'Balance\nCodex usage draws from your shared agentic usage limit\n\n5 hour usage limit\n40%\nremaining\nResets 2:21 PM\nWeekly usage limit\n86%\nremaining\nResets Jun 8, 2026 10:59 AM';
    const parsed = parseLimitText(capturedText);
    expect(parsed).not.toBeNull();
    expect(parsed!.limits).toHaveLength(2);
    const snapshot = createManualLimitSnapshot({ provider_id: 'chatgpt', provider_name: 'ChatGPT', plan: 'ChatGPT Plus', limits: parsed!.limits.map((l) => ({ window: l.window, used: l.used, total: l.total, unit: l.unit, remaining: l.remaining })) });
    expect(validateSnapshot(snapshot)).toBeNull();
    return store.saveSnapshot(snapshot).then(async () => {
      const loaded = await store.getSnapshot('chatgpt');
      expect(loaded).not.toBeNull();
      expect(loaded!.source).toBe('manual');
      const payload = loaded!.payload as any;
      expect(payload.limits).toHaveLength(2);
      const summary = generateSummary(snapshot);
      expect(summary.primary_metric).toContain('40% 剩余');
    });
  });

  it('should not affect DeepSeek data when saving ChatGPT', async () => {
    const payload = createBalancePayload({ remaining_amount: 42.5, currency: 'CNY' });
    await store.saveSnapshot(createSnapshot({ provider_id: 'deepseek', provider_name: 'DeepSeek', source: 'official_api', quota_model: 'balance', payload }));
    await store.saveSnapshot(createManualLimitSnapshot({ provider_id: 'chatgpt', provider_name: 'ChatGPT', limits: [{ window: '5h', used: 40, total: 100, unit: 'percent', remaining: 60 }] }));
    expect((await store.getSnapshot('deepseek'))!.payload as any).toBeDefined();
    expect((await store.getSnapshot('chatgpt'))).not.toBeNull();
  });
});

// ============================================================
// Flow 3: Dashboard state isolation (unchanged)
// ============================================================
describe('Flow: Dashboard state isolation', () => {
  let tmpDir: string; let store: Store;
  beforeEach(() => { tmpDir = setupTmpDir(); store = new Store(tmpDir); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should return correct summaries for each provider independently', async () => {
    const dsPayload = createBalancePayload({ remaining_amount: 50.71, currency: 'CNY' });
    const ds = createSnapshot({ provider_id: 'deepseek', provider_name: 'DeepSeek', source: 'official_api', quota_model: 'balance', payload: dsPayload });
    const cg = createManualLimitSnapshot({ provider_id: 'chatgpt', provider_name: 'ChatGPT', limits: [{ window: '5h', used: 60, total: 100, unit: 'percent', remaining: 40 }] });
    await store.saveSnapshot(ds); await store.saveSnapshot(cg);
    const dsSummary = generateSummary(await store.getSnapshot('deepseek'));
    const cgSummary = generateSummary(await store.getSnapshot('chatgpt'));
    expect(dsSummary.provider_id).toBe('deepseek');
    expect(dsSummary.primary_metric).toContain('¥');
    expect(cgSummary.provider_id).toBe('chatgpt');
    expect(cgSummary.primary_metric).toContain('%');
  });
});

// ============================================================
// Flow 4: Burn rate with history (unchanged)
// ============================================================
describe('Flow: Burn rate with history', () => {
  let tmpDir: string; let store: Store;
  beforeEach(() => { tmpDir = setupTmpDir(); store = new Store(tmpDir); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should compute burn rate from multiple DeepSeek snapshots', async () => {
    const entries = [
      { captured_at: '2026-06-01T10:00:00Z', remaining_amount: 53, currency: 'CNY' },
      { captured_at: '2026-06-02T10:00:00Z', remaining_amount: 51, currency: 'CNY' },
      { captured_at: '2026-06-03T10:00:00Z', remaining_amount: 49, currency: 'CNY' },
      { captured_at: '2026-06-04T10:00:00Z', remaining_amount: 47, currency: 'CNY' },
    ];
    for (const e of entries) await store.appendHistory('deepseek', e);
    const history = await store.getHistory('deepseek');
    expect(history).toHaveLength(4);
    const processed = processHistory(history);
    const burnRate = calculateBurnRate(processed);
    expect(burnRate).not.toBeNull();
    expect(burnRate!.value).toBeCloseTo(2, 0);
    expect(burnRate!.confidence).toBe('medium');
    const remaining = estimateRemaining(47, burnRate!);
    expect(remaining).not.toBeNull();
    expect(remaining!.unit).toBe('days');
  });
});

// ============================================================
// Flow 5: errorSnapshot + generateSummary pipeline (NEW)
// Tests the main-process callback pattern for null-snapshot cases.
// This is the code path that was missing tests — the glue between
// adapter output and IPC push that caused the loading-deadlock bug.
// ============================================================

/** Replica of the index.ts errorSnapshot helper for testability */
function makeErrorSnapshot(
  id: string, name: string, source: ProviderSource, quota_model: QuotaModel,
  reason?: string, errorStatus: string = 'error',
): ProviderSnapshot {
  let payload: any;
  if (quota_model === 'balance') payload = { remaining_amount: 0, currency: 'CNY' };
  else if (quota_model === 'limit') payload = { limits: [] };
  else if (quota_model === 'cost') payload = { periods: [] };
  else payload = { periods: [] };
  return { provider_id: id, provider_name: name, source, quota_model, captured_at: new Date().toISOString(), status: errorStatus as any, status_reason: reason, payload };
}

describe('Flow: errorSnapshot → generateSummary pipeline', () => {
  it('should produce summary with correct provider_id for Kimi (balance) on auth_required', () => {
    const ers = makeErrorSnapshot('kimi', 'Kimi', 'official_api', 'balance', 'API key not configured', 'auth_required');
    const summary = generateSummary(ers);
    expect(summary.provider_id).toBe('kimi');
    expect(summary.display_name).toBe('Kimi');
    expect(summary.status).toBe('auth_required');
  });

  it('should produce summary with correct provider_id for OpenAI (cost) on error', () => {
    const ers = makeErrorSnapshot('openai_platform', 'OpenAI Platform', 'official_api', 'cost', 'Network timeout', 'error');
    const summary = generateSummary(ers);
    expect(summary.provider_id).toBe('openai_platform');
    expect(summary.status).toBe('error');
  });

  it('should produce summary with correct provider_id for DeepSeek (balance) on error', () => {
    const ers = makeErrorSnapshot('deepseek', 'DeepSeek', 'official_api', 'balance', 'Connection refused', 'error');
    const summary = generateSummary(ers);
    expect(summary.provider_id).toBe('deepseek');
    expect(summary.status).toBe('error');
  });

  it('should never produce unknown provider_id from errorSnapshot', () => {
    for (const pid of ['kimi', 'deepseek', 'openai_platform', 'chatgpt']) {
      const ers = makeErrorSnapshot(pid, pid, 'official_api', 'balance', 'test', 'error');
      const summary = generateSummary(ers);
      expect(summary.provider_id).toBe(pid);
      expect(summary.provider_id).not.toBe('unknown');
    }
  });

  it('should handle null lastSuccess gracefully', () => {
    const ers = makeErrorSnapshot('kimi', 'Kimi', 'official_api', 'balance', 'No key', 'auth_required');
    const summary = generateSummary(ers, null);
    expect(summary.provider_id).toBe('kimi');
    expect(summary.status).toBe('auth_required');
    // Should not crash
    expect(summary.primary_metric).toBeTruthy();
  });
});
