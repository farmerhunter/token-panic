import type { ProviderAdapter, AdapterContext, FetchResult } from '../shared/types';
import { DEEPSEEK_META } from '../shared/provider-metadata';
import { createSnapshot, createBalancePayload } from '../domain/normalize';

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
const REQUEST_TIMEOUT_MS = 15_000;

// ---- DeepSeek API response shapes ----

interface DeepSeekBalanceInfo {
  currency: string;
  total_balance: string;
  topped_up_balance: string;
  granted_balance: string;
}

interface DeepSeekBalanceResponse {
  is_available: boolean;
  balance_infos: DeepSeekBalanceInfo[];
}

// ---- Adapter ----

function parseBalanceResponse(
  data: DeepSeekBalanceResponse,
): { remaining_amount: number; currency: string } {
  if (!data.is_available) {
    throw new Error('DeepSeek balance is not available');
  }
  if (!Array.isArray(data.balance_infos) || data.balance_infos.length === 0) {
    throw new Error('DeepSeek response missing balance_infos');
  }

  // Sum all balances; prefer CNY if available, otherwise use the first currency
  let totalRemaining = 0;
  let primaryCurrency = data.balance_infos[0].currency;

  for (const info of data.balance_infos) {
    const amount = parseFloat(info.total_balance);
    if (isNaN(amount)) {
      throw new Error(`Invalid balance amount: ${info.total_balance}`);
    }
    totalRemaining += amount;
    if (info.currency === 'CNY') {
      primaryCurrency = 'CNY';
    }
  }

  return { remaining_amount: totalRemaining, currency: primaryCurrency };
}

export const deepseekAdapter: ProviderAdapter = {
  id: DEEPSEEK_META.provider_id,
  name: DEEPSEEK_META.display_name,
  source: 'official_api',
  quota_model: 'balance',
  refresh_interval_min: 30,

  async fetchSnapshot(context: AdapterContext): Promise<FetchResult> {
    if (!context.apiKey) {
      return {
        snapshot: null,
        error: {
          status: 'auth_required',
          reason: 'API key not configured',
        },
      };
    }

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      response = await fetch(DEEPSEEK_BALANCE_URL, {
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

    // Handle HTTP errors
    if (response.status === 401 || response.status === 403) {
      return {
        snapshot: null,
        error: {
          status: 'auth_required',
          reason: `DeepSeek API key 认证失败 (HTTP ${response.status})。请检查 key 是否正确。`,
        },
      };
    }

    if (response.status === 429) {
      return {
        snapshot: null,
        error: {
          status: 'stale',
          reason: 'Rate limited by DeepSeek API',
        },
      };
    }

    if (!response.ok) {
      return {
        snapshot: null,
        error: {
          status: 'error',
          reason: `DeepSeek API returned HTTP ${response.status}`,
        },
      };
    }

    // Parse response body
    let rawData: unknown;
    try {
      rawData = await response.json();
    } catch {
      return {
        snapshot: null,
        error: {
          status: 'error',
          reason: 'Failed to parse DeepSeek API response as JSON',
        },
      };
    }

    // Validate and normalize
    try {
      const balanceData = parseBalanceResponse(rawData as DeepSeekBalanceResponse);
      const payload = createBalancePayload({
        remaining_amount: balanceData.remaining_amount,
        currency: balanceData.currency,
      });
      const snapshot = createSnapshot({
        provider_id: 'deepseek',
        provider_name: 'DeepSeek',
        source: 'official_api',
        quota_model: 'balance',
        payload,
      });

      return { snapshot };
    } catch (err: any) {
      return {
        snapshot: null,
        error: {
          status: 'error',
          reason: `Schema error: ${err.message}`,
        },
      };
    }
  },
};
