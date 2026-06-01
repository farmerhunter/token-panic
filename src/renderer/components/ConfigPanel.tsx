import React, { useState, useEffect } from 'react';
import type { ConfigData } from '@shared/types';

interface Props {
  onBack: () => void;
  onSaved: () => void;
}

export function ConfigPanel({ onBack, onSaved }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onConfigReply((data: ConfigData) => {
      setHasKey(data.has_key);
    });

    api.requestConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    window.electronAPI?.updateConfig('deepseek', apiKey.trim());
    // The main process will trigger a refresh after saving;
    // we give it a moment then call onSaved
    setTimeout(() => {
      setSaving(false);
      onSaved();
    }, 500);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>
          ← 返回
        </button>
        <span style={styles.title}>设置</span>
        <span style={{ width: 50 }} />
      </div>

      <div style={styles.content}>
        <div style={styles.section}>
          <div style={styles.label}>DeepSeek API Key</div>
          <div style={styles.hint}>
            在 DeepSeek 平台「API Keys」页面创建。密钥保存在本地，不会上传。
          </div>
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
        </div>

        <button
          style={{
            ...styles.saveBtn,
            opacity: apiKey.trim() ? 1 : 0.4,
          }}
          disabled={!apiKey.trim() || saving}
          onClick={handleSave}
        >
          {saving ? '保存中…' : '保存并刷新'}
        </button>
      </div>
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
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  section: {
    marginBottom: 16,
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
    marginTop: 'auto',
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
