import React from 'react';
import type { ProviderSummary } from '@shared/types';

interface Props {
  summary: ProviderSummary | null;
  loading: boolean;
}

export function BalancePanel({ summary, loading }: Props) {
  if (loading && !summary) {
    return (
      <div style={styles.card}>
        <div style={styles.loadingText}>加载中…</div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div style={styles.card}>
        <div style={styles.errorText}>无法获取数据</div>
      </div>
    );
  }

  const statusLabel = getStatusLabel(summary.status);

  return (
    <div style={styles.card}>
      <div style={styles.providerRow}>
        <span style={styles.providerName}>{summary.display_name}</span>
        <span style={{ ...styles.statusBadge, ...statusBadgeStyle(summary.status) }}>
          {statusLabel}
        </span>
      </div>

      <div style={styles.metricRow}>
        <span style={styles.primaryMetric}>{summary.primary_metric}</span>
      </div>

      {summary.secondary_metric && (
        <div style={styles.secondaryRow}>
          <span style={styles.secondaryMetric}>{summary.secondary_metric}</span>
        </div>
      )}

      {summary.estimated_remaining && (
        <div style={styles.remainingRow}>
          <span style={styles.remainingText}>
            按当前速度约还能撑 {formatRemaining(summary.estimated_remaining)}
          </span>
          {summary.burn_rate?.confidence && summary.burn_rate.confidence !== 'high' && (
            <span style={styles.confidenceHint}>
              {summary.burn_rate.confidence === 'medium' ? '(估算中)' : '(数据积累中)'}
            </span>
          )}
        </div>
      )}

      <div style={styles.fetchTime}>
        {formatTimeAgo(summary.last_fetch)}
      </div>
    </div>
  );
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'ok': return '正常';
    case 'stale': return '可能过期';
    case 'error': return '获取失败';
    case 'auth_required': return '需要认证';
    case 'disabled': return '已关闭';
    default: return status;
  }
}

function statusBadgeStyle(status: string): React.CSSProperties {
  switch (status) {
    case 'ok': return { background: '#e8f5e9', color: '#2e7d32' };
    case 'error':
    case 'auth_required': return { background: '#fbe9e7', color: '#c62828' };
    case 'stale': return { background: '#fff3e0', color: '#e65100' };
    default: return { background: '#f5f5f5', color: '#616161' };
  }
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return '刚刚刷新';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  return `${Math.floor(diffMs / 86_400_000)} 天前`;
}

function formatRemaining(estimated: { value: number; unit: string }): string {
  switch (estimated.unit) {
    case 'minutes':
      return '< 1 小时';
    case 'hours':
      return `约 ${estimated.value} 小时`;
    case 'days':
      if (estimated.value >= 30) return '> 30 天';
      return `约 ${estimated.value} 天`;
    default:
      return '';
  }
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#ffffff',
    borderRadius: 10,
    padding: '14px 16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  loadingText: {
    color: '#86868b',
    textAlign: 'center',
    padding: '20px 0',
  },
  errorText: {
    color: '#c62828',
    textAlign: 'center',
    padding: '20px 0',
  },
  providerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  providerName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#1d1d1f',
  },
  statusBadge: {
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 8,
    fontWeight: 500,
  },
  metricRow: {
    marginBottom: 4,
  },
  primaryMetric: {
    fontSize: 22,
    fontWeight: 700,
    color: '#1d1d1f',
  },
  secondaryRow: {
    marginBottom: 8,
  },
  secondaryMetric: {
    fontSize: 12,
    color: '#86868b',
  },
  fetchTime: {
    fontSize: 11,
    color: '#aeaeb2',
  },
  remainingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  remainingText: {
    fontSize: 12,
    color: '#1d1d1f',
    fontWeight: 500,
  },
  confidenceHint: {
    fontSize: 11,
    color: '#86868b',
  },
};
