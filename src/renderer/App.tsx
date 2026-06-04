import React, { useEffect, useState } from 'react';
import { useSnapshot } from './hooks/useSnapshot';
import { BalancePanel } from './components/BalancePanel';
import { LimitPanel } from './components/LimitPanel';
import { StatusBar } from './components/StatusBar';
import { ConfigPanel } from './components/ConfigPanel';
import { ManualInputForm } from './components/ManualInputForm';
import { toDashboardViewModel } from './dashboard-view-model';
import type { ProviderSummary } from '@shared/types';

// ---- State machine: single View type replaces 4 boolean flags ----
// Only ONE view is active at a time. TypeScript ensures exhaustiveness.

type View =
  | { page: 'dashboard' }
  | { page: 'settings' }
  | { page: 'quick-capture' }
  | { page: 'manual-input' };

const CHATGPT_EMPTY: ProviderSummary = {
  provider_id: 'chatgpt',
  display_name: 'ChatGPT',
  status: 'manual_required',
  quota_model: 'limit',
  source: 'manual',
  primary_metric: '',
  last_fetch: new Date().toISOString(),
};

export function App() {
  const { summary: deepseekSummary, loading, refresh } = useSnapshot('deepseek');
  const { summary: chatgptSummary } = useSnapshot('chatgpt', CHATGPT_EMPTY);
  const { summary: openaiSummary, loading: openaiLoading, refresh: refreshOpenAI } = useSnapshot('openai_platform');
  const { summary: kimiSummary, loading: kimiLoading, refresh: refreshKimi } = useSnapshot('kimi');
  const [view, setView] = useState<View>({ page: 'dashboard' });

  useEffect(() => {
    return window.electronAPI?.onOpenSettingsRequested(() => {
      setView({ page: 'settings' });
    });
  }, []);

  // ---- Navigation helpers ----

  const goDashboard = () => setView({ page: 'dashboard' });
  const goSettings = () => setView({ page: 'settings' });
  const goQuickCapture = () => setView({ page: 'quick-capture' });
  const goManualInput = () => setView({ page: 'manual-input' });

  // ---- Render: switch on view.page (TypeScript checks exhaustiveness) ----

  switch (view.page) {
    // --- Quick capture: Safari auto-read → parse → countdown → save ---
    case 'quick-capture':
      return (
        <SubPage title="" onBack={goDashboard}>
          <ManualInputForm quickRefresh onSaved={goDashboard} />
        </SubPage>
      );

    // --- Manual input: structured form ---
    case 'manual-input':
      return (
        <SubPage title="手动录入" onBack={goDashboard}>
          <ManualInputForm onSaved={goDashboard} />
        </SubPage>
      );

    // --- Settings: DeepSeek API key ---
    case 'settings':
      return (
        <ConfigPanel
          onBack={goDashboard}
          onSaved={goDashboard}
        />
      );

    // --- Dashboard: main view ---
    case 'dashboard': {
      const refreshHandlers: Record<string, () => void> = {
        refresh_deepseek: refresh,
        refresh_kimi: refreshKimi,
        refresh_openai_platform: refreshOpenAI,
      };

      const dashboard = toDashboardViewModel({
        deepseekSummary,
        deepseekLoading: loading,
        kimiSummary,
        kimiLoading,
        openaiSummary,
        openaiLoading,
        chatgptSummary,
      });

      return (
        <div style={styles.container}>
          <div style={styles.header}>
            <span style={styles.title}>token恐慌</span>
            <div style={styles.headerActions}>
              {dashboard.headerActions.includes('refresh_deepseek') && (
                <button style={styles.headerBtn} onClick={refresh}>刷新</button>
              )}
              {dashboard.headerActions.includes('open_settings') && (
                <button style={styles.headerBtn} onClick={goSettings}>设置</button>
              )}
            </div>
          </div>

          <div style={styles.content}>
            {/* Balance providers */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>余额型</div>
              {dashboard.balanceProviders.map((bp) => (
                <div key={bp.provider_id} style={{ marginBottom: bp.provider_id !== dashboard.balanceProviders[dashboard.balanceProviders.length - 1].provider_id ? 8 : 0 }}>
                  <BalancePanel
                    summary={bp.summary}
                    loading={bp.loading}
                    onRefresh={bp.actions.length > 0 ? refreshHandlers[bp.actions[0]] : undefined}
                  />
                </div>
              ))}
            </div>

            {/* Limit providers */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>限额型</div>
              {dashboard.limitProvider.kind === 'empty' ? (
                <div style={styles.emptyCard}>
                  <div style={styles.emptyText}>{dashboard.limitProvider.title}</div>
                  <div style={styles.cardActions}>
                    {dashboard.limitProvider.actions.includes('quick_capture_chatgpt') && (
                      <button style={styles.primaryAction} onClick={goQuickCapture}>
                        从 Safari 读取
                      </button>
                    )}
                    {dashboard.limitProvider.actions.includes('manual_input_chatgpt') && (
                      <button style={styles.secondaryAction} onClick={goManualInput}>
                        手动输入
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <LimitPanel
                  summary={dashboard.limitProvider.summary}
                  onRefresh={dashboard.limitProvider.actions.includes('quick_capture_chatgpt') ? goQuickCapture : undefined}
                  onManualEdit={dashboard.limitProvider.actions.includes('manual_input_chatgpt') ? goManualInput : undefined}
                />
              )}
            </div>

            {/* Cost/Usage providers */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>用量/费用</div>
              <BalancePanel
                summary={dashboard.costProvider.summary}
                loading={dashboard.costProvider.loading}
                onRefresh={dashboard.costProvider.actions.length > 0 ? refreshHandlers[dashboard.costProvider.actions[0]] : undefined}
              />
            </div>
          </div>

          <StatusBar summary={deepseekSummary} loading={loading} />
        </div>
      );
    }
  }
}

// ---- Sub-page wrapper (shared by quick-capture, manual-input, settings) ----

function SubPage({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backLink} onClick={onBack}>← 返回</button>
        <span style={styles.title}>{title}</span>
        <span style={{ width: 50 }} />
      </div>
      <div style={styles.content}>{children}</div>
    </div>
  );
}

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100vh', padding: '12px 16px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 14, fontWeight: 700, color: '#1d1d1f' },
  headerActions: { display: 'flex', gap: 6, alignItems: 'center' },
  headerBtn: { background: 'none', border: 'none', fontSize: 12, color: '#007aff', cursor: 'pointer', padding: '2px 6px', fontWeight: 500 },
  backLink: { background: 'none', border: 'none', fontSize: 12, color: '#007aff', cursor: 'pointer', padding: 0 },
  content: { flex: 1, overflow: 'auto' },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: 600, color: '#8e8e93', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6, paddingLeft: 2 },
  emptyCard: { background: '#ffffff', borderRadius: 10, padding: '20px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center' },
  emptyText: { fontSize: 13, color: '#007aff', fontWeight: 500, marginBottom: 4 },
  cardActions: { display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 },
  primaryAction: { padding: '6px 14px', fontSize: 12, fontWeight: 600, color: '#ffffff', background: '#007aff', border: 'none', borderRadius: 6, cursor: 'pointer' },
  secondaryAction: { padding: '6px 14px', fontSize: 12, color: '#007aff', background: 'none', border: '1px solid #007aff', borderRadius: 6, cursor: 'pointer' },
};
