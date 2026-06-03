import React, { useState, useEffect } from 'react';
import type { ConfigData } from '@shared/types';
import { CONFIGURABLE_PROVIDER_METAS } from '@shared/provider-metadata';

interface Props {
  onBack: () => void;
  onSaved: () => void;
}

export function ConfigPanel({ onBack, onSaved }: Props) {
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
};
