import React, { useState } from 'react';
import { useSnapshot } from './hooks/useSnapshot';
import { BalancePanel } from './components/BalancePanel';
import { StatusBar } from './components/StatusBar';
import { ConfigPanel } from './components/ConfigPanel';

export function App() {
  const { summary, loading, refresh } = useSnapshot();
  const [showConfig, setShowConfig] = useState(false);

  if (showConfig) {
    return (
      <ConfigPanel
        onBack={() => setShowConfig(false)}
        onSaved={() => {
          setShowConfig(false);
          refresh();
        }}
      />
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>token恐慌</span>
        <div style={styles.headerActions}>
          <button
            style={styles.iconBtn}
            onClick={refresh}
            title="刷新"
          >
            🔄
          </button>
          <button
            style={styles.iconBtn}
            onClick={() => setShowConfig(true)}
            title="设置"
          >
            ⚙
          </button>
        </div>
      </div>

      <div style={styles.content}>
        <BalancePanel summary={summary} loading={loading} />
      </div>

      <StatusBar summary={summary} loading={loading} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    padding: '12px 16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: '#1d1d1f',
  },
  headerActions: {
    display: 'flex',
    gap: 4,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    fontSize: 14,
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 4,
  },
  content: {
    flex: 1,
  },
};
