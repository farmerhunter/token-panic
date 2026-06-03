import { describe, it, expect, vi } from 'vitest';
import { openaiPlatformAdapter } from './openai-platform';

describe('openaiPlatformAdapter', () => {
  it('should have correct metadata', () => {
    expect(openaiPlatformAdapter.id).toBe('openai_platform');
    expect(openaiPlatformAdapter.name).toBe('OpenAI Platform');
    expect(openaiPlatformAdapter.source).toBe('official_api');
    expect(openaiPlatformAdapter.quota_model).toBe('cost');
  });

  it('should return auth_required when no API key is provided', async () => {
    const result = await openaiPlatformAdapter.fetchSnapshot({});
    expect(result.snapshot).toBeNull();
    expect(result.error?.status).toBe('auth_required');
  });

  it('should parse a valid costs API response', async () => {
    // Mock the /v1/organization/costs response
    const mockResponse = {
      object: 'list',
      data: [
        {
          line_item: 'gpt-5.5',
          project_id: 'proj_abc',
          aggregated: [
            { spend_amount_usd: 0.84, start_time: 1717200000, end_time: 1717286400 },
          ],
        },
        {
          line_item: 'gpt-5.4',
          project_id: 'proj_abc',
          aggregated: [
            { spend_amount_usd: 0.21, start_time: 1717200000, end_time: 1717286400 },
          ],
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await openaiPlatformAdapter.fetchSnapshot({ apiKey: 'sk-admin-test' });
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot!.provider_id).toBe('openai_platform');
    expect(result.snapshot!.quota_model).toBe('cost');
    expect(result.snapshot!.status).toBe('ok');

    const payload = result.snapshot!.payload as any;
    // Today's spend should be sum of all line items: 0.84 + 0.21 = 1.05
    expect(payload.periods).toHaveLength(1);
    expect(payload.periods[0].key).toBe('day');
    expect(payload.periods[0].spend_amount).toBeCloseTo(1.05, 2);
    expect(payload.periods[0].currency).toBe('USD');
  });

  it('should return auth_required on HTTP 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    const result = await openaiPlatformAdapter.fetchSnapshot({ apiKey: 'sk-bad' });
    expect(result.error?.status).toBe('auth_required');
  });

  it('should return error on HTTP 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await openaiPlatformAdapter.fetchSnapshot({ apiKey: 'sk-admin' });
    expect(result.error?.status).toBe('error');
  });

  it('should return error on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const result = await openaiPlatformAdapter.fetchSnapshot({ apiKey: 'sk-admin' });
    expect(result.error?.status).toBe('error');
    expect(result.error?.reason).toContain('Connection refused');
  });

  it('should return error on empty data array', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: 'list', data: [] }),
    });

    const result = await openaiPlatformAdapter.fetchSnapshot({ apiKey: 'sk-admin' });
    expect(result.error?.status).toBe('error');
    expect(result.error?.reason).toContain('No cost data');
  });
});
