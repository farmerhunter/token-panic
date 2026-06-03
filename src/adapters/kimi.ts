import type { ProviderAdapter, AdapterContext, FetchResult } from '../shared/types';
import { createSnapshot, createBalancePayload } from '../domain/normalize';

const KIMI_BALANCE_URL = 'https://api.moonshot.cn/v1/users/me/balance';
const REQUEST_TIMEOUT_MS = 15_000;

interface KimiBalanceResponse {
  code: number;
  data?: {
    available_balance: number;
    voucher_balance: number;
    cash_balance: number;
  };
  scode?: string;
  status: boolean;
}

export const kimiAdapter: ProviderAdapter = {
  id: 'kimi',
  name: 'Kimi',
  source: 'official_api',
  quota_model: 'balance',
  refresh_interval_min: 60,

  async fetchSnapshot(context: AdapterContext): Promise<FetchResult> {
    if (!context.apiKey) {
      return {
        snapshot: null,
        error: { status: 'auth_required', reason: 'API key not configured' },
      };
    }

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      response = await fetch(KIMI_BALANCE_URL, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${context.apiKey}`,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
    } catch (err: any) {
      return {
        snapshot: null,
        error: {
          status: 'error',
          reason: err.name === 'AbortError'
            ? 'Request timed out'
            : `Network error: ${err.message}`,
        },
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        snapshot: null,
        error: {
          status: 'auth_required',
          reason: `认证失败 (HTTP ${response.status})。请确认 API key 有效且属于中国区 (api.moonshot.cn)。`,
        },
      };
    }

    if (!response.ok) {
      return {
        snapshot: null,
        error: { status: 'error', reason: `Kimi API returned HTTP ${response.status}` },
      };
    }

    let rawData: KimiBalanceResponse;
    try {
      rawData = (await response.json()) as KimiBalanceResponse;
    } catch {
      return {
        snapshot: null,
        error: { status: 'error', reason: 'Failed to parse Kimi API response' },
      };
    }

    // Validate response: status must be true, code must be 0 (DD-026)
    if (rawData.status !== true || rawData.code !== 0) {
      return {
        snapshot: null,
        error: {
          status: 'error',
          reason: `Kimi API returned code=${rawData.code}, scode=${rawData.scode || 'unknown'}`,
        },
      };
    }

    if (!rawData.data || typeof rawData.data.available_balance !== 'number') {
      return {
        snapshot: null,
        error: { status: 'error', reason: 'Missing available_balance in Kimi API response' },
      };
    }

    const amount = rawData.data.available_balance;
    if (!Number.isFinite(amount) || amount < 0) {
      return {
        snapshot: null,
        error: { status: 'error', reason: `Invalid available_balance: ${amount}` },
      };
    }

    const payload = createBalancePayload({
      remaining_amount: Math.round(amount * 100) / 100,
      currency: 'CNY', // DD-026: Kimi platform uses CNY billing
    });

    const snapshot = createSnapshot({
      provider_id: 'kimi',
      provider_name: 'Kimi',
      source: 'official_api',
      quota_model: 'balance',
      payload,
    });

    return { snapshot };
  },
};
