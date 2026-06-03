import { describe, it, expect, vi } from 'vitest';
import { kimiAdapter } from './kimi';

describe('kimiAdapter', () => {
  it('should have correct metadata', () => {
    expect(kimiAdapter.id).toBe('kimi');
    expect(kimiAdapter.name).toBe('Kimi');
    expect(kimiAdapter.source).toBe('official_api');
    expect(kimiAdapter.quota_model).toBe('balance');
  });

  it('should return auth_required when no API key is provided', async () => {
    const result = await kimiAdapter.fetchSnapshot({});
    expect(result.snapshot).toBeNull();
    expect(result.error?.status).toBe('auth_required');
  });

  it('should parse a valid balance response', async () => {
    const mockResponse = {
      code: 0,
      data: {
        available_balance: 49.58,
        voucher_balance: 46.58,
        cash_balance: 3.00,
      },
      scode: '0x0',
      status: true,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await kimiAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot!.provider_id).toBe('kimi');
    expect(result.snapshot!.provider_name).toBe('Kimi');
    expect(result.snapshot!.source).toBe('official_api');
    expect(result.snapshot!.quota_model).toBe('balance');
    expect(result.snapshot!.status).toBe('ok');

    const payload = result.snapshot!.payload as any;
    expect(payload.remaining_amount).toBeCloseTo(49.58, 2);
    expect(payload.currency).toBe('CNY');
  });

  it('should return auth_required with region hint on HTTP 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    const result = await kimiAdapter.fetchSnapshot({ apiKey: 'sk-bad' });
    expect(result.error?.status).toBe('auth_required');
    expect(result.error?.reason).toContain('认证失败');
    expect(result.error?.reason).toContain('api.moonshot.cn');
  });

  it('should return auth_required on HTTP 403', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });
    const result = await kimiAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('auth_required');
  });

  it('should return error on HTTP 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const result = await kimiAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('error');
    expect(result.error?.reason).toContain('500');
  });

  it('should return error on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const result = await kimiAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('error');
  });

  it('should return error when code is not 0', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 1001,
        data: null,
        scode: '0x1',
        status: false,
      }),
    });
    const result = await kimiAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('error');
    expect(result.error?.reason).toContain('code');
  });

  it('should return error on missing data field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        status: true,
      }),
    });
    const result = await kimiAdapter.fetchSnapshot({ apiKey: 'sk-test' });
    expect(result.error?.status).toBe('error');
  });
});
