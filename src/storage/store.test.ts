import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Store } from './store';
import { createSnapshot, createBalancePayload } from '../domain/normalize';

function makeSnapshot(providerId = 'deepseek', remaining = 42.5): ReturnType<typeof createSnapshot> {
  const payload = createBalancePayload({ remaining_amount: remaining, currency: 'CNY' });
  return createSnapshot({
    provider_id: providerId,
    provider_name: providerId === 'deepseek' ? 'DeepSeek' : 'Test',
    source: 'official_api',
    quota_model: 'balance',
    payload,
  });
}

describe('Store', () => {
  let store: Store;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-panic-store-'));
    store = new Store(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return default data when no file exists', async () => {
    const data = await store.loadData();
    expect(data.schema_version).toBe(1);
    expect(data.snapshots).toEqual({});
    expect(data.preferences.auto_refresh).toBe(true);
    expect(data.preferences.default_refresh_interval_min).toBe(30);
  });

  it('should save and load data', async () => {
    const snapshot = makeSnapshot();
    await store.saveSnapshot(snapshot);
    const loaded = await store.getSnapshot('deepseek');
    expect(loaded).not.toBeNull();
    expect(loaded!.provider_id).toBe('deepseek');
  });

  it('should persist data across Store instances', async () => {
    const snapshot = makeSnapshot();
    await store.saveSnapshot(snapshot);

    // Create a new store pointing to the same directory
    const store2 = new Store(tmpDir);
    const loaded = await store2.getSnapshot('deepseek');
    expect(loaded).not.toBeNull();
    expect(loaded!.provider_id).toBe('deepseek');
  });

  it('should return null for non-existent provider', async () => {
    const snapshot = await store.getSnapshot('nonexistent');
    expect(snapshot).toBeNull();
  });

  it('should overwrite existing snapshot for same provider', async () => {
    await store.saveSnapshot(makeSnapshot('deepseek', 100));
    await store.saveSnapshot(makeSnapshot('deepseek', 42.5));

    const loaded = await store.getSnapshot('deepseek');
    const payload = loaded!.payload as any;
    expect(payload.remaining_amount).toBe(42.5);
  });

  it('should store multiple providers independently', async () => {
    await store.saveSnapshot(makeSnapshot('deepseek', 100));
    await store.saveSnapshot(makeSnapshot('openai', 50));

    const ds = await store.getSnapshot('deepseek');
    const oa = await store.getSnapshot('openai');
    expect((ds!.payload as any).remaining_amount).toBe(100);
    expect((oa!.payload as any).remaining_amount).toBe(50);
  });

  it('should update preferences', async () => {
    await store.updatePreferences({ auto_refresh: false });
    const prefs = await store.getPreferences();
    expect(prefs.auto_refresh).toBe(false);
    expect(prefs.default_refresh_interval_min).toBe(30); // unchanged
  });

  it('should create data.json on disk', async () => {
    await store.saveSnapshot(makeSnapshot());
    const dataPath = path.join(tmpDir, 'data.json');
    expect(fs.existsSync(dataPath)).toBe(true);
  });

  // ---- History (Phase 2) ----

  it('should return empty history for unknown provider', async () => {
    const history = await store.getHistory('deepseek');
    expect(history).toEqual([]);
  });

  it('should append and retrieve history entries', async () => {
    await store.appendHistory('deepseek', {
      captured_at: '2026-06-01T10:00:00Z',
      remaining_amount: 50,
      currency: 'CNY',
    });
    await store.appendHistory('deepseek', {
      captured_at: '2026-06-02T10:00:00Z',
      remaining_amount: 48,
      currency: 'CNY',
    });

    const history = await store.getHistory('deepseek');
    expect(history).toHaveLength(2);
    expect(history[0].remaining_amount).toBe(50);
    expect(history[1].remaining_amount).toBe(48);
  });

  it('should cap history at 500 entries per provider', async () => {
    const manyEntries = Array.from({ length: 510 }, (_, i) => ({
      captured_at: `2026-06-01T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
      remaining_amount: 100 - i * 0.1,
      currency: 'CNY' as const,
    }));

    for (const entry of manyEntries) {
      await store.appendHistory('deepseek', entry);
    }

    const history = await store.getHistory('deepseek');
    expect(history.length).toBeLessThanOrEqual(500);
  });

  it('should isolate history by provider', async () => {
    await store.appendHistory('deepseek', {
      captured_at: '2026-06-01T10:00:00Z',
      remaining_amount: 50,
      currency: 'CNY',
    });
    await store.appendHistory('openai', {
      captured_at: '2026-06-01T10:00:00Z',
      remaining_amount: 20,
      currency: 'USD',
    });

    expect(await store.getHistory('deepseek')).toHaveLength(1);
    expect(await store.getHistory('openai')).toHaveLength(1);
  });

  it('should create history.json on disk', async () => {
    await store.appendHistory('deepseek', {
      captured_at: '2026-06-01T10:00:00Z',
      remaining_amount: 50,
      currency: 'CNY',
    });
    const historyPath = path.join(tmpDir, 'history.json');
    expect(fs.existsSync(historyPath)).toBe(true);
  });
});
