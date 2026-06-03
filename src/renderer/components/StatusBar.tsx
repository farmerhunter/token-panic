import React from 'react';
import type { ProviderSummary } from '@shared/types';

interface Props {
  summary: ProviderSummary | null;
  loading: boolean;
}

export function StatusBar({ summary, loading }: Props) {
  let text: string;
  let color: string;

  if (loading && !summary) {
    text = '正在获取数据…';
    color = '#86868b';
  } else if (!summary) {
    text = '无数据';
    color = '#c62828';
  } else if (summary.status === 'ok') {
    text = '数据正常';
    color = '#2e7d32';
  } else if (summary.status === 'auth_required') {
    text = '需要配置 API Key — 点击设置';
    color = '#c62828';
  } else if (summary.status === 'error') {
    text = '获取失败，显示的是上次数据';
    color = '#e65100';
  } else if (summary.status === 'stale') {
    text = '数据可能已过期';
    color = '#e65100';
  } else {
    text = '已关闭';
    color = '#86868b';
  }

  return (
    <div style={{
      ...styles.bar,
      borderTopColor: summary?.status === 'error' || summary?.status === 'auth_required' ? '#ffcdd2' : '#e8e8ed',
    }}>
      <span style={{ ...styles.text, color }}>
        {text}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    borderTop: '1px solid',
    paddingTop: 8,
    marginTop: 8,
  },
  text: {
    fontSize: 11,
  },
};
