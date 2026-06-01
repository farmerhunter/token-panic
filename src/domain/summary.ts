import type {
  ProviderSnapshot,
  ProviderSummary,
  BalancePayload,
  LimitPayload,
  UsagePayload,
  CostPayload,
  BurnRate,
  EstimatedRemaining,
} from '../shared/types';

/**
 * Generate a ProviderSummary from the latest fetch result.
 *
 * If the snapshot status is not 'ok' and a last_success_snapshot is provided,
 * the summary uses the last success data as fallback while preserving the
 * current error/auth/stale status.
 *
 * burnRate and estimatedRemaining are optional — pass them when
 * sufficient history exists. See design_decision.md DD-008, DD-009, DD-010.
 *
 * This is a pure function — it does not read storage or hold state.
 */
export function generateSummary(
  snapshot: ProviderSnapshot | null,
  lastSuccessSnapshot?: ProviderSnapshot | null,
  burnRate?: BurnRate | null,
  estimatedRemaining?: EstimatedRemaining | null,
): ProviderSummary {
  // No data at all
  if (!snapshot && !lastSuccessSnapshot) {
    return {
      provider_id: 'unknown',
      display_name: 'Unknown',
      status: 'error',
      quota_model: 'balance',
      source: 'official_api',
      primary_metric: '无数据',
      last_fetch: new Date().toISOString(),
    };
  }

  // Determine which snapshot to use for data vs status
  // - ok / disabled → use its own data and status
  // - error / auth_required / stale → use lastSuccessSnapshot data, current snapshot status
  const useOwnData = !snapshot
    || snapshot.status === 'ok'
    || snapshot.status === 'disabled'
    || !lastSuccessSnapshot;

  const dataSource = useOwnData ? (snapshot ?? lastSuccessSnapshot!) : lastSuccessSnapshot;
  const summary = buildBaseSummary(dataSource);

  // Apply current status and timestamp
  if (snapshot) {
    summary.status = snapshot.status;
    summary.last_fetch = snapshot.captured_at;

    if (snapshot.status !== 'ok' && snapshot.status !== 'disabled' && lastSuccessSnapshot) {
      summary.secondary_metric = summary.secondary_metric
        ? `${summary.secondary_metric} · 数据已过期`
        : '数据已过期';
    }

    // Attach burn rate and estimated remaining only when status is ok
    if (snapshot.status === 'ok') {
      if (burnRate) summary.burn_rate = burnRate;
      if (estimatedRemaining) summary.estimated_remaining = estimatedRemaining;
    }
  }

  return summary;
}

function buildBaseSummary(snapshot: ProviderSnapshot): ProviderSummary {
  const base: ProviderSummary = {
    provider_id: snapshot.provider_id,
    display_name: snapshot.provider_name,
    status: snapshot.status,
    quota_model: snapshot.quota_model,
    source: snapshot.source,
    primary_metric: '',
    last_fetch: snapshot.captured_at,
  };

  switch (snapshot.quota_model) {
    case 'balance':
      return buildBalanceSummary(base, snapshot.payload as BalancePayload);
    case 'limit':
      return buildLimitSummary(base, snapshot.payload as LimitPayload);
    case 'usage':
      return buildUsageSummary(base, snapshot.payload as UsagePayload);
    case 'cost':
      return buildCostSummary(base, snapshot.payload as CostPayload);
    default:
      base.primary_metric = '未知模型';
      return base;
  }
}

function buildBalanceSummary(
  base: ProviderSummary,
  payload: BalancePayload,
): ProviderSummary {
  const symbol = payload.currency === 'USD' ? '$' : '¥';
  base.primary_metric = `${symbol}${payload.remaining_amount.toFixed(2)} 剩余`;

  const parts: string[] = [];
  if (payload.period) {
    if (payload.period.used_tokens !== undefined) {
      parts.push(`${formatTokens(payload.period.used_tokens)} tokens`);
    }
    if (payload.period.spend_amount !== undefined) {
      parts.push(`${symbol}${payload.period.spend_amount.toFixed(2)}`);
    }
    if (payload.period.request_count !== undefined) {
      parts.push(`${payload.period.request_count} 次请求`);
    }
    if (parts.length > 0) {
      base.secondary_metric = `本月 ${parts.join(' · ')}`;
    }
  }

  return base;
}

function buildLimitSummary(
  base: ProviderSummary,
  payload: LimitPayload,
): ProviderSummary {
  const parts = payload.limits.map((limit) => {
    const usedStr = limit.unit === 'tokens' ? formatTokens(limit.used) : String(limit.used);
    const totalStr = limit.unit === 'tokens' ? formatTokens(limit.total) : String(limit.total);
    return `${limit.window} ${usedStr}/${totalStr}`;
  });
  base.primary_metric = parts.join('  ');
  return base;
}

function buildUsageSummary(
  base: ProviderSummary,
  payload: UsagePayload,
): ProviderSummary {
  const parts: string[] = [];
  for (const period of payload.periods) {
    if (period.used_tokens !== undefined) {
      parts.push(`${period.key === 'day' ? '今日' : period.key === 'week' ? '本周' : '本月'} ${formatTokens(period.used_tokens)} tokens`);
    }
  }
  base.primary_metric = parts.join('  ') || '有用量数据';
  return base;
}

function buildCostSummary(
  base: ProviderSummary,
  payload: CostPayload,
): ProviderSummary {
  const parts: string[] = [];
  for (const period of payload.periods) {
    const symbol = period.currency === 'USD' ? '$' : '¥';
    const label = period.key === 'day' ? '今日' : period.key === 'week' ? '本周' : '本月';
    parts.push(`${label} ${symbol}${period.spend_amount.toFixed(2)}`);
  }
  base.primary_metric = parts.join('  ') || '有费用数据';
  return base;
}

// ---- helpers ----

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(0)}K`;
  }
  return String(n);
}
