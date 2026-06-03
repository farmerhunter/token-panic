import type { ProviderAdapter, AdapterContext, FetchResult } from '../shared/types';
import type { CostPayload } from '../shared/types';
import { OPENAI_PLATFORM_META } from '../shared/provider-metadata';
import { createSnapshot } from '../domain/normalize';

const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs';
const REQUEST_TIMEOUT_MS = 15_000;

interface CostsAggregated {
  spend_amount_usd: number;
  start_time: number;
  end_time: number;
}

interface CostsLineItem {
  line_item?: string;
  aggregated: CostsAggregated[];
}

interface CostsResponse {
  object: string;
  data: CostsLineItem[];
}

export const openaiPlatformAdapter: ProviderAdapter = {
  id: OPENAI_PLATFORM_META.provider_id,
  name: OPENAI_PLATFORM_META.display_name,
  source: 'official_api',
  quota_model: 'cost',
  refresh_interval_min: 60, // once per hour — costs don't change that fast

  async fetchSnapshot(context: AdapterContext): Promise<FetchResult> {
    if (!context.apiKey) {
      return {
        snapshot: null,
        error: { status: 'auth_required', reason: 'API key not configured' },
      };
    }

    // Today's start (midnight UTC) and end (now)
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startTime = Math.floor(startOfDay.getTime() / 1000);
    const endTime = Math.floor(now.getTime() / 1000);

    const url = `${OPENAI_COSTS_URL}?start_time=${startTime}&end_time=${endTime}&bucket_width=1d`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      response = await fetch(url, {
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
          reason: `OpenAI Platform API key 认证失败 (HTTP ${response.status})。请确认使用的是 organization admin key（非普通 secret key，非 ChatGPT 订阅）。`,
        },
      };
    }

    if (!response.ok) {
      return {
        snapshot: null,
        error: { status: 'error', reason: `OpenAI API returned HTTP ${response.status}` },
      };
    }

    let rawData: CostsResponse;
    try {
      rawData = (await response.json()) as CostsResponse;
    } catch {
      return {
        snapshot: null,
        error: { status: 'error', reason: 'Failed to parse OpenAI API response' },
      };
    }

    if (!Array.isArray(rawData.data) || rawData.data.length === 0) {
      return {
        snapshot: null,
        error: { status: 'error', reason: 'No cost data available for today' },
      };
    }

    // Sum spend across all line items for today
    let totalSpend = 0;
    for (const item of rawData.data) {
      for (const agg of item.aggregated) {
        totalSpend += agg.spend_amount_usd;
      }
    }

    const payload: CostPayload = {
      periods: [
        {
          key: 'day',
          spend_amount: Math.round(totalSpend * 100) / 100, // round to cents
          currency: 'USD',
        },
      ],
    };

    const snapshot = createSnapshot({
      provider_id: 'openai_platform',
      provider_name: 'OpenAI Platform',
      source: 'official_api',
      quota_model: 'cost',
      payload,
    });

    return { snapshot };
  },
};
