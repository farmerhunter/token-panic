import React from 'react';
import type { ProviderSummary } from '@shared/types';

interface Props {
  summary: ProviderSummary;
  onRefresh?: () => void;
  onManualEdit?: () => void;
}

export function LimitPanel({ summary, onRefresh, onManualEdit }: Props) {
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

      <div style={styles.sourceRow}>
        <span style={styles.sourceLabel}>
          {summary.capture_method === 'safari_visible_tab' ? 'Safari 读取' : summary.source === 'manual' ? '手动录入' : '自动'}
        </span>
        <span style={styles.separator}>·</span>
        <span style={styles.fetchTime}>{formatTimeAgo(summary.last_fetch)}</span>
        {onRefresh && (
          <>
            <span style={styles.separator}>·</span>
            <button style={styles.refreshLink} onClick={onRefresh}>
              从 Safari 更新
            </button>
          </>
        )}
        {onManualEdit && (
          <>
            <span style={styles.separator}>·</span>
            <button style={styles.refreshLink} onClick={onManualEdit}>
              手动修改
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'ok': return '正常';
    case 'manual_required': return '待录入';
    case 'disabled': return '已关闭';
    default: return status;
  }
}

function statusBadgeStyle(status: string): React.CSSProperties {
  switch (status) {
    case 'ok': return { background: '#e8f5e9', color: '#2e7d32' };
    case 'manual_required': return { background: '#fff3e0', color: '#e65100' };
    case 'disabled': return { background: '#f5f5f5', color: '#9e9e9e' };
    default: return { background: '#f5f5f5', color: '#616161' };
  }
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 60_000) return '刚刚';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  return `${Math.floor(diffMs / 86_400_000)} 天前`;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#ffffff',
    borderRadius: 10,
    padding: '14px 16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
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
    fontSize: 15,
    fontWeight: 600,
    color: '#1d1d1f',
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap',
  },
  secondaryRow: {
    marginBottom: 6,
  },
  secondaryMetric: {
    fontSize: 12,
    color: '#86868b',
  },
  sourceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  sourceLabel: {
    fontSize: 11,
    color: '#aeaeb2',
  },
  separator: {
    fontSize: 11,
    color: '#d2d2d7',
  },
  fetchTime: {
    fontSize: 11,
    color: '#aeaeb2',
  },
  refreshLink: {
    background: 'none',
    border: 'none',
    fontSize: 11,
    color: '#007aff',
    cursor: 'pointer',
    padding: 0,
  },
};
