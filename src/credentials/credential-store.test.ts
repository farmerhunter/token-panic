import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileCredentialStore } from './credential-store';

describe('FileCredentialStore', () => {
  let store: FileCredentialStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-panic-test-'));
    store = new FileCredentialStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null when no key is stored', async () => {
    const key = await store.get('deepseek');
    expect(key).toBeNull();
  });

  it('should store and retrieve an API key', async () => {
    await store.set('deepseek', 'sk-test-abc123');
    const key = await store.get('deepseek');
    expect(key).toBe('sk-test-abc123');
  });

  it('should overwrite an existing key', async () => {
    await store.set('deepseek', 'sk-old-key');
    await store.set('deepseek', 'sk-new-key');
    const key = await store.get('deepseek');
    expect(key).toBe('sk-new-key');
  });

  it('should isolate keys by provider ID', async () => {
    await store.set('deepseek', 'sk-deepseek');
    await store.set('openai', 'sk-openai');

    expect(await store.get('deepseek')).toBe('sk-deepseek');
    expect(await store.get('openai')).toBe('sk-openai');
  });

  it('should delete a stored key', async () => {
    await store.set('deepseek', 'sk-test');
    await store.delete('deepseek');
    expect(await store.get('deepseek')).toBeNull();
  });

  it('should not throw when deleting a non-existent key', async () => {
    await expect(store.delete('nonexistent')).resolves.not.toThrow();
  });

  it('should create files with restricted permissions', async () => {
    await store.set('deepseek', 'sk-test');
    const filePath = path.join(tmpDir, 'auth', 'api', 'deepseek.json');
    const stat = fs.statSync(filePath);
    // 0o600 in octal
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('should store metadata alongside the key', async () => {
    await store.set('deepseek', 'sk-test');
    const filePath = path.join(tmpDir, 'auth', 'api', 'deepseek.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.api_key).toBe('sk-test');
    expect(data.updated_at).toBeTruthy();
    expect(Date.parse(data.updated_at)).not.toBeNaN();
  });
});
