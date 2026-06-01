import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deepseekAdapter } from './deepseek';

describe('deepseekAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should have correct metadata', () => {
    expect(deepseekAdapter.id).toBe('deepseek');
    expect(deepseekAdapter.name).toBe('DeepSeek');
    expect(deepseekAdapter.source).toBe('official_api');
    expect(deepseekAdapter.quota_model).toBe('balance');
    expect(deepseekAdapter.refresh_interval_min).toBe(30);
  });

  it('should return auth_required when no API key is provided', async () => {
    const result = await deepseekAdapter.fetchSnapshot({});
    expect(result.snapshot).toBeNull();
    expect(result.error?.status).toBe('auth_required');
    expect(result.error?.reason).toContain('not configured');
  });

  it('should parse a valid DeepSeek balance response', async () => {
    const mockResponse = {
      is_available: true,
      balance_infos: [
        {
          currency: 'CNY',
          total_balance: '100.50',
          topped_up_balance: '80.00',
          granted_balance: '20.50',
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await deepseekAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot!.status).toBe('ok');
    expect(result.snapshot!.quota_model).toBe('balance');
    expect(result.snapshot!.provider_id).toBe('deepseek');

    const payload = result.snapshot!.payload as any;
    expect(payload.remaining_amount).toBe(100.5);
    expect(payload.currency).toBe('CNY');
  });

  it('should return auth_required on HTTP 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    const result = await deepseekAdapter.fetchSnapshot({ apiKey: 'sk-bad' });
    expect(result.snapshot).toBeNull();
    expect(result.error?.status).toBe('auth_required');
  });

  it('should return auth_required on HTTP 403', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });

    const result = await deepseekAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('auth_required');
  });

  it('should return stale on HTTP 429 (rate limit)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    });

    const result = await deepseekAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('stale');
    expect(result.error?.reason).toContain('Rate limited');
  });

  it('should return error on other HTTP errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await deepseekAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('error');
    expect(result.error?.reason).toContain('500');
  });

  it('should return error on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const result = await deepseekAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('error');
    expect(result.error?.reason).toContain('Connection refused');
  });

  it('should return error on invalid JSON response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token');
      },
    });

    const result = await deepseekAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('error');
    expect(result.error?.reason).toContain('parse');
  });

  it('should return error when is_available is false', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        is_available: false,
        balance_infos: [],
      }),
    });

    const result = await deepseekAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('error');
    expect(result.error?.reason).toContain('not available');
  });

  it('should return error on malformed balance_infos', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: 'not-a-number' }],
      }),
    });

    const result = await deepseekAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('error');
    expect(result.error?.reason).toContain('Invalid balance amount');
  });
});
