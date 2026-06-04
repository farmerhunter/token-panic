import React, { useState, useEffect, useCallback } from 'react';
import type { ConfigData } from '@shared/types';
import { CONFIGURABLE_PROVIDER_METAS } from '@shared/provider-metadata';

interface Props {
  onBack: () => void;
  onSaved: () => void;
}

export function ConfigPanel({ onBack, onSaved }: Props) {
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [startupSupported, setStartupSupported] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const unsub = api.onStartupReply((data: any) => {
      setOpenAtLogin(data.openAtLogin);
      setStartupSupported(data.supported);
    });
    api.getStartupSettings();
    return unsub;
  }, []);

  const toggleStartup = useCallback(() => {
    const next = !openAtLogin;
    setOpenAtLogin(next);
    window.electronAPI?.setStartupSettings(next);
  }, [openAtLogin]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← 返回</button>
        <span style={styles.title}>设置</span>
        <span style={{ width: 50 }} />
      </div>

      <div style={styles.scrollContent}>
        {CONFIGURABLE_PROVIDER_METAS.map((meta) => (
          <ApiKeySection
            key={meta.provider_id}
            providerId={meta.provider_id}
            label={meta.credential_label!}
            hint={meta.credential_hint!}
            onSaved={onSaved}
          />
        ))}

        {startupSupported && (
          <div style={styles.section}>
            <div style={styles.startupRow}>
              <div>
                <div style={styles.label}>开机启动</div>
                <div style={styles.hint}>登录时自动在菜单栏启动 token-panic</div>
              </div>
              <button
                style={{
                  ...styles.toggle,
                  background: openAtLogin ? '#34c759' : '#e5e5ea',
                }}
                onClick={toggleStartup}
              >
                <span style={{
                  ...styles.toggleKnob,
                  marginLeft: openAtLogin ? 20 : 2,
                }}>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ApiKeySection({ providerId, label, hint, onSaved }: {
  providerId: string;
  label: string;
  hint: string;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const unsubscribe = api.onConfigReply((data: ConfigData) => {
      if (data.provider_id === providerId) {
        setHasKey(data.has_key);
      }
    });

    api.requestConfig();

    return unsubscribe;
  }, [providerId]);

  const handleSave = async () => {
    setSaving(true);
    const unsubscribe = window.electronAPI?.onSnapshotUpdated(() => {
      unsubscribe?.();
      setSaving(false);
      onSaved();
    });
    setTimeout(() => {
      if (unsubscribe) { unsubscribe(); setSaving(false); onSaved(); }
    }, 8000);
    window.electronAPI?.updateConfig(providerId, apiKey.trim());
  };

  return (
    <div style={styles.section}>
      <div style={styles.label}>{label}</div>
      <div style={styles.hint}>{hint}</div>
      <input
        type="password"
        style={styles.input}
        placeholder={hasKey ? '已配置（输入新密钥覆盖）' : 'sk-…'}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && apiKey.trim()) handleSave();
        }}
      />
      {apiKey.trim() && (
        <button style={styles.saveBtn} disabled={saving} onClick={handleSave}>
          {saving ? '保存中…' : '保存并刷新'}
        </button>
      )}
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
    marginBottom: 16,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    fontSize: 12,
    color: '#007aff',
    cursor: 'pointer',
    padding: 0,
    width: 50,
    textAlign: 'left',
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: '#1d1d1f',
  },
  scrollContent: {
    flex: 1,
    overflow: 'auto',
  },
  section: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottom: '1px solid #e8e8ed',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    marginBottom: 4,
  },
  expandIcon: {
    fontSize: 12,
    color: '#86868b',
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#1d1d1f',
    marginBottom: 4,
  },
  hint: {
    fontSize: 11,
    color: '#86868b',
    marginBottom: 8,
    lineHeight: 1.4,
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: '1px solid #d2d2d7',
    borderRadius: 6,
    outline: 'none',
    background: '#ffffff',
  },
  saveBtn: {
    marginTop: 8,
    width: '100%',
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#ffffff',
    background: '#007aff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  startupRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    position: 'relative' as const,
    transition: 'background 0.2s',
  },
  toggleKnob: {
    display: 'block',
    width: 24,
    height: 24,
    borderRadius: 12,
    background: '#ffffff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'margin-left 0.2s',
  },
};
