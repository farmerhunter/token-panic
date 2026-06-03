/**
 * Integration tests — full pipeline verification.
 * Simulates complete user flows: DeepSeek fetch, ChatGPT Safari capture,
 * dashboard state transitions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Store } from '../storage/store';
import { FileCredentialStore } from '../credentials/credential-store';
import { createManualLimitSnapshot, validateSnapshot, createBalancePayload, createSnapshot } from '../domain/normalize';
import { generateSummary } from '../domain/summary';
import { parseLimitText } from '../domain/text-parser';
import { processHistory } from '../domain/history';
import { calculateBurnRate } from '../domain/burn-rate';
import { estimateRemaining } from '../domain/estimated-remaining';
import type { ProviderSummary, ProviderSnapshot } from '../shared/types';

function setupTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-integration-'));
  return dir;
}

// ============================================================
// Flow 1: Full DeepSeek pipeline
// ============================================================
describe('Flow: DeepSeek balance fetch', () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = setupTmpDir();
    store = new Store(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should save snapshot, generate summary, and persist correctly', async () => {
    // Step 1: Adapter produces a snapshot
    const payload = createBalancePayload({ remaining_amount: 53.68, currency: 'CNY' });
    const snapshot = createSnapshot({
      provider_id: 'deepseek',
      provider_name: 'DeepSeek',
      source: 'official_api',
      quota_model: 'balance',
      payload,
    });

    // Step 2: Save to storage
    await store.saveSnapshot(snapshot);
    const loaded = await store.getSnapshot('deepseek');
    expect(loaded).not.toBeNull();
    expect((loaded!.payload as any).remaining_amount).toBe(53.68);

    // Step 3: Generate summary
    const summary = generateSummary(snapshot);
    expect(summary.provider_id).toBe('deepseek');
    expect(summary.primary_metric).toBe('¥53.68 剩余');
    expect(summary.status).toBe('ok');

    // Step 4: Verify persistence
    const data = await store.loadData();
    expect(data.snapshots['deepseek']).toBeDefined();
  });

  it('should not overwrite ChatGPT data when saving DeepSeek', async () => {
    // Pre-populate ChatGPT
    const chatgptSnapshot = createManualLimitSnapshot({
      provider_id: 'chatgpt',
      provider_name: 'ChatGPT',
      limits: [{ window: '5h', used: 60, total: 100, unit: 'percent' }],
    });
    await store.saveSnapshot(chatgptSnapshot);

    // Save DeepSeek
    const payload = createBalancePayload({ remaining_amount: 50.71, currency: 'CNY' });
    const dsSnapshot = createSnapshot({
      provider_id: 'deepseek',
      provider_name: 'DeepSeek',
      source: 'official_api',
      quota_model: 'balance',
      payload,
    });
    await store.saveSnapshot(dsSnapshot);

    // Both should be intact
    const ds = await store.getSnapshot('deepseek');
    const cg = await store.getSnapshot('chatgpt');
    expect((ds!.payload as any).remaining_amount).toBe(50.71);
    expect((cg!.payload as any).limits[0].window).toBe('5h');
  });
});

// ============================================================
// Flow 2: ChatGPT Safari capture → manual snapshot pipeline
// ============================================================
describe('Flow: ChatGPT manual snapshot', () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = setupTmpDir();
    store = new Store(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create snapshot from Safari-captured + parsed text', () => {
    // Step 1: Simulate Safari captured innerText
    const capturedText = `
Balance
Codex usage draws from your shared agentic usage limit

5 hour usage limit
40%
remaining
Resets 2:21 PM
Weekly usage limit
86%
remaining
Resets Jun 8, 2026 10:59 AM
    `;

    // Step 2: Parse
    const parsed = parseLimitText(capturedText);
    expect(parsed).not.toBeNull();
    expect(parsed!.limits).toHaveLength(2);

    // Step 3: Create snapshot via manual pipeline
    const snapshot = createManualLimitSnapshot({
      provider_id: 'chatgpt',
      provider_name: 'ChatGPT',
      plan: 'ChatGPT Plus',
      limits: parsed!.limits.map((l) => ({
        window: l.window,
        used: l.used,
        total: l.total,
        unit: l.unit,
        remaining: l.remaining,
      })),
    });

    // Step 4: Validate — must pass
    expect(validateSnapshot(snapshot)).toBeNull();

    // Step 5: Save
    return store.saveSnapshot(snapshot).then(async () => {
      const loaded = await store.getSnapshot('chatgpt');
      expect(loaded).not.toBeNull();
      expect(loaded!.source).toBe('manual');
      expect(loaded!.quota_model).toBe('limit');

      const payload = loaded!.payload as any;
      expect(payload.limits).toHaveLength(2);
      expect(payload.limits[0].window).toBe('5h');
      expect(payload.limits[0].remaining).toBe(40);
      expect(payload.limits[1].window).toBe('week');
      expect(payload.limits[1].remaining).toBe(86);

      // Step 6: Generate summary
      const summary = generateSummary(snapshot);
      expect(summary.primary_metric).toContain('40% 剩余');
      expect(summary.primary_metric).toContain('86% 剩余');
    });
  });

  it('should not affect DeepSeek data when saving ChatGPT', async () => {
    // Pre-populate DeepSeek
    const payload = createBalancePayload({ remaining_amount: 42.5, currency: 'CNY' });
    const dsSnapshot = createSnapshot({
      provider_id: 'deepseek',
      provider_name: 'DeepSeek',
      source: 'official_api',
      quota_model: 'balance',
      payload,
    });
    await store.saveSnapshot(dsSnapshot);

    // Save ChatGPT
    const cgSnapshot = createManualLimitSnapshot({
      provider_id: 'chatgpt',
      provider_name: 'ChatGPT',
      limits: [{ window: '5h', used: 40, total: 100, unit: 'percent', remaining: 60 }],
    });
    await store.saveSnapshot(cgSnapshot);

    // DeepSeek must be unchanged
    const ds = await store.getSnapshot('deepseek');
    expect((ds!.payload as any).remaining_amount).toBe(42.5);

    // ChatGPT must be saved
    const cg = await store.getSnapshot('chatgpt');
    expect(cg).not.toBeNull();
  });
});

// ============================================================
// Flow 3: Dashboard state transitions (provider isolation)
// ============================================================
describe('Flow: Dashboard state isolation', () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = setupTmpDir();
    store = new Store(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return correct summaries for each provider independently', async () => {
    // Setup both providers
    const dsPayload = createBalancePayload({ remaining_amount: 50.71, currency: 'CNY' });
    const dsSnapshot = createSnapshot({
      provider_id: 'deepseek', provider_name: 'DeepSeek',
      source: 'official_api', quota_model: 'balance', payload: dsPayload,
    });

    const cgSnapshot = createManualLimitSnapshot({
      provider_id: 'chatgpt', provider_name: 'ChatGPT',
      limits: [{ window: '5h', used: 60, total: 100, unit: 'percent', remaining: 40 }],
    });

    await store.saveSnapshot(dsSnapshot);
    await store.saveSnapshot(cgSnapshot);

    // Generate summaries independently
    const dsLoaded = await store.getSnapshot('deepseek');
    const cgLoaded = await store.getSnapshot('chatgpt');

    const dsSummary = generateSummary(dsLoaded);
    const cgSummary = generateSummary(cgLoaded);

    // Verify isolation — DeepSeek summary does NOT contain ChatGPT data
    expect(dsSummary.provider_id).toBe('deepseek');
    expect(dsSummary.primary_metric).toContain('¥');
    expect(dsSummary.primary_metric).not.toContain('%');

    // ChatGPT summary does NOT contain DeepSeek data
    expect(cgSummary.provider_id).toBe('chatgpt');
    expect(cgSummary.primary_metric).toContain('%');
    expect(cgSummary.primary_metric).not.toContain('¥');
  });
});

// ============================================================
// Flow 4: Burn rate + history with multiple snapshots
// ============================================================
describe('Flow: Burn rate with history', () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = setupTmpDir();
    store = new Store(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should compute burn rate from multiple DeepSeek snapshots over time', async () => {
    // Simulate 3 days of consumption: ¥53 → ¥51 → ¥49 → ¥47
    const entries = [
      { captured_at: '2026-06-01T10:00:00Z', remaining_amount: 53, currency: 'CNY' },
      { captured_at: '2026-06-02T10:00:00Z', remaining_amount: 51, currency: 'CNY' },
      { captured_at: '2026-06-03T10:00:00Z', remaining_amount: 49, currency: 'CNY' },
      { captured_at: '2026-06-04T10:00:00Z', remaining_amount: 47, currency: 'CNY' },
    ];

    for (const entry of entries) {
      await store.appendHistory('deepseek', entry);
    }

    const history = await store.getHistory('deepseek');
    expect(history).toHaveLength(4);

    const processed = processHistory(history);
    const burnRate = calculateBurnRate(processed);
    expect(burnRate).not.toBeNull();
    expect(burnRate!.value).toBeCloseTo(2, 0); // ~¥2/day
    expect(burnRate!.confidence).toBe('medium'); // 4 clusters, 72h span

    const remaining = estimateRemaining(47, burnRate!);
    expect(remaining).not.toBeNull();
    expect(remaining!.unit).toBe('days');
  });
});
