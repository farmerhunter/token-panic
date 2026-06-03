import React, { useState, useEffect, useRef } from 'react';
import type { SafariTabInfo, CaptureResult } from '../../main/safari-capture';
import type { ParsedLimit } from '../../domain/text-parser';
import type { ParserDiagnostics } from '../../shared/diagnostics';
import { formatDiagnosticSummary } from '../../shared/diagnostics';

// We import parseLimitText dynamically since it's a domain module
// accessible via the shared import path through vite aliases

interface ManualLimitDraft {
  window: string;
  used: number;
  total: number;
  unit: string;
}

type Mode = 'idle' | 'safari-searching' | 'safari-probing' | 'safari-found' | 'safari-js-disabled' | 'safari-reading' | 'safari-parsed' | 'safari-parse-failed' | 'manual-form' | 'saving';

interface Props {
  onSaved: () => void;
  quickRefresh?: boolean;
}

export function ManualInputForm({ onSaved, quickRefresh = false }: Props) {
  const [mode, setMode] = useState<Mode>(quickRefresh ? 'safari-searching' : 'idle');
  const [isQuickRefresh, setIsQuickRefresh] = useState(quickRefresh);
  const [safariTab, setSafariTab] = useState<SafariTabInfo | null>(null);
  const [capturedText, setCapturedText] = useState<string | null>(null);
  const [captureTraceId, setCaptureTraceId] = useState<string | null>(null);
  const [parserDiagnostics, setParserDiagnostics] = useState<ParserDiagnostics | null>(null);
  const [parsedLimits, setParsedLimits] = useState<ParsedLimit[] | null>(null);
  const [manualLimits, setManualLimits] = useState<ManualLimitDraft[]>([
    { window: '5h', used: 0, total: 0, unit: 'tokens' },
  ]);
  const [plan, setPlan] = useState('ChatGPT Plus');
  const [jsDisabledMessage, setJsDisabledMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugBundlePath, setDebugBundlePath] = useState<string | null>(null);
  const [diagnosticSummaryCopied, setDiagnosticSummaryCopied] = useState(false);
  const [debugBundlePathCopied, setDebugBundlePathCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaveCountdown, setAutoSaveCountdown] = useState<number | null>(null);

  // Ref for quickRefresh — avoids stale closure in IPC callbacks
  const quickRefreshRef = useRef(quickRefresh);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Quick refresh: auto-start Safari capture on mount ----

  useEffect(() => {
    if (quickRefresh) {
      handleSafariCapture();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- IPC listeners ----

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const unsubscribers = [
      api.onSafariTabFound((tab) => {
      if (tab) {
        setSafariTab(tab);
        setMode('safari-probing');
        // Immediately probe JS capability before showing confirm UI
        api.probeSafariJS();
      } else {
        quickRefreshRef.current = false;
        setError('未找到 ChatGPT analytics 页面。请先在 Safari 中打开并登录该页面。');
        setMode('idle');
      }
    }),

      api.onSafariProbeResult((result: any) => {
      if (result.jsEnabled) {
        if (quickRefreshRef.current) {
          setMode('safari-reading');
          api.readSafariTab();
        } else {
          setMode('safari-found');
        }
      } else {
        quickRefreshRef.current = false;
        setJsDisabledMessage(result.errorMessage || 'Safari JS 不可用');
        setMode('safari-js-disabled');
      }
    }),

      api.onSafariTextRead((result: CaptureResult) => {
      setCapturedText(result.text);
      setCaptureTraceId(result.trace_id);
      // Parse the text using dynamic import of text-parser
      import('../../domain/text-parser').then(({ parseLimitTextWithDiagnostics }) => {
        const parsed = parseLimitTextWithDiagnostics(result.text, result.trace_id);
        setParserDiagnostics(parsed.diagnostics);
        api.recordParserDiagnostics({
          trace_id: result.trace_id,
          status: parsed.result ? 'ok' : 'error',
          metadata: {
            text_length: parsed.diagnostics.text_length,
            line_count: parsed.diagnostics.line_count,
            candidate_count: parsed.diagnostics.candidate_lines.length,
            strategies_tried: parsed.diagnostics.strategies_tried,
          },
          error: parsed.result ? undefined : {
            type: parsed.diagnostics.failure_reason || 'parse_failed',
            message: 'Limit parser did not produce a usable result',
          },
        });
        if (parsed.result && parsed.result.limits.length > 0) {
          setParsedLimits(parsed.result.limits);
          if (quickRefreshRef.current) {
            setAutoSaveCountdown(5);
            const timer = setInterval(() => {
              setAutoSaveCountdown((prev) => {
                if (prev === null || prev <= 1) {
                  clearInterval(timer);
                  saveSnapshot(parsed.result.limits);
                  return null;
                }
                return prev - 1;
              });
            }, 1000);
            countdownRef.current = timer;
          } else {
            setMode('safari-parsed');
          }
        } else {
          quickRefreshRef.current = false;
          setMode('safari-parse-failed');
        }
      }).catch(() => {
        setError('解析器加载失败，请使用手动输入。');
        setMode('manual-form');
      });
    }),

      api.onSafariCaptureError((err) => {
      const messages: Record<string, string> = {
        safari_not_running: 'Safari 未运行。请先打开 Safari 并登录 ChatGPT。',
        tab_not_found: '未找到 ChatGPT analytics 页面。',
        js_not_enabled: '需要开启 Safari 开发菜单中的"允许 Apple Events 执行 JavaScript"。',
        apple_events_denied: '需要授予自动化权限。请在系统设置中允许。',
        read_failed: '读取失败，请尝试手动输入。',
        empty_page_text: '页面文本为空，请确认 Safari 页面已加载完成。',
      };
      setError(messages[err.type] || err.message);
      setMode('manual-form');
    }),

      api.onManualSnapshotSaved((result) => {
      setSaving(false);
      if (result.error) {
        setError(result.error);
      } else {
        onSaved();
      }
    }),

      api.onDebugBundleExported((result) => {
      if (result.success && result.path) {
        setDebugBundlePath(result.path);
        setDebugBundlePathCopied(false);
      } else {
        setError(result.error || '导出诊断包失败');
      }
    }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [onSaved]);

  // ---- Actions ----

  const handleSafariCapture = () => {
    setError(null);
    setDebugBundlePath(null);
    setParserDiagnostics(null);
    setCaptureTraceId(null);
    setCapturedText(null);
    setMode('safari-searching');
    window.electronAPI?.findSafariTab();
  };

  const handleConfirmSafariRead = () => {
    setError(null);
    setMode('safari-reading');
    window.electronAPI?.readSafariTab();
  };

  const handleSaveParsed = () => {
    if (!parsedLimits) return;
    saveSnapshot(parsedLimits);
  };

  const handleSaveManual = () => {
    // Convert form data to ParsedLimit-compatible format
    const limits = manualLimits
      .filter((l) => l.used > 0 || l.total > 0)
      .map((l) => ({
        window: l.window,
        used: l.used,
        total: l.total,
        unit: l.unit,
        confidence: 1.0,
      }));
    if (limits.length === 0) {
      setError('请至少填写一组限额数据');
      return;
    }
    saveSnapshot(limits);
  };

  const saveSnapshot = (limits: ParsedLimit[]) => {
    setSaving(true);
    setError(null);
    window.electronAPI?.saveManualSnapshot({
      provider_id: 'chatgpt',
      provider_name: 'ChatGPT',
      plan,
      capture_method: quickRefreshRef.current ? 'safari_visible_tab' : 'manual_form',
      limits: limits.map((l) => ({
        window: l.window,
        used: l.used,
        total: l.total,
        unit: l.unit,
        remaining: l.remaining,
      })),
    });
  };

  const removeManualLimit = (index: number) => {
    if (manualLimits.length <= 1) return;
    setManualLimits(manualLimits.filter((_, i) => i !== index));
  };

  const addManualLimit = () => {
    setManualLimits([...manualLimits, { window: 'day', used: 0, total: 0, unit: 'tokens' }]);
  };

  const updateManualLimit = (index: number, field: keyof ManualLimitDraft, value: string | number) => {
    const updated = [...manualLimits];
    updated[index] = { ...updated[index], [field]: value };
    setManualLimits(updated);
  };

  const switchToManual = () => {
    setError(null);
    // Pre-fill from parser candidate lines if available (P1-I)
    if (parserDiagnostics?.candidate_lines?.length) {
      const prefillLimits: ManualLimitDraft[] = [];
      for (const cl of parserDiagnostics.candidate_lines) {
        // Try to extract number pairs from candidate snippets
        const pairMatch = cl.snippet.match(/([\d,.]+)\s*[KkMmBb]?\s*\/\s*([\d,.]+)\s*[KkMmBb]?/);
        if (pairMatch) {
          const total = parseInt(pairMatch[2].replace(/[,，]/g, ''), 10);
          const used = parseInt(pairMatch[1].replace(/[,，]/g, ''), 10);
          if (!isNaN(used) && !isNaN(total) && total > 0) {
            prefillLimits.push({
              window: '5h',
              used: used > 999 ? Math.round(used / 1000) * 1000 : used,
              total: total > 999 ? Math.round(total / 1000) * 1000 : total,
              unit: 'tokens',
            });
          }
        }
      }
      if (prefillLimits.length > 0) {
        setManualLimits(prefillLimits);
      }
    }
    setMode('manual-form');
  };

  const handleExportDiagnostics = (includeRawText: boolean) => {
    if (!captureTraceId) {
      setError('没有可导出的 trace，请重新读取页面。');
      return;
    }
    window.electronAPI?.exportDebugBundle({
      trace_id: captureTraceId,
      parser_diagnostics: parserDiagnostics ?? undefined,
      include_raw_text: includeRawText,
      capture_method: 'safari_visible_tab',
    });
  };

  const buildDiagnosticSummary = (rawTextIncluded = false) => formatDiagnosticSummary({
    trace_id: captureTraceId,
    parser_diagnostics: parserDiagnostics,
    bundle_path: debugBundlePath,
    raw_text_included: rawTextIncluded,
  });

  const handleCopyDiagnosticSummary = async () => {
    const summary = buildDiagnosticSummary(false);
    try {
      await navigator.clipboard.writeText(summary);
      setDiagnosticSummaryCopied(true);
      window.setTimeout(() => setDiagnosticSummaryCopied(false), 1500);
    } catch {
      setError(summary);
    }
  };

  const handleCopyDebugBundlePath = async () => {
    if (!debugBundlePath) return;
    try {
      await navigator.clipboard.writeText(debugBundlePath);
      setDebugBundlePathCopied(true);
      window.setTimeout(() => setDebugBundlePathCopied(false), 1500);
    } catch {
      setError(debugBundlePath);
    }
  };

  const handleRevealDebugBundle = () => {
    if (!debugBundlePath) return;
    window.electronAPI?.revealDebugBundle(debugBundlePath);
  };

  // ---- Render helpers ----

  const renderIdle = () => (
    <div>
      <button style={styles.primaryBtn} onClick={handleSafariCapture}>
        从 Safari 自动读取
      </button>
      <div style={styles.hint}>
        Safari 需已打开并登录 ChatGPT analytics 页面
      </div>
      <div style={styles.divider}>
        <span style={styles.dividerText}>或</span>
      </div>
      <button style={styles.secondaryBtn} onClick={switchToManual}>
        手动输入限额数据
      </button>
    </div>
  );

  const renderSafariSearching = () => (
    <div style={styles.statusBox}>
      <span>正在查找 Safari 中的 ChatGPT 页面…</span>
    </div>
  );

  const renderSafariProbing = () => (
    <div style={styles.statusBox}>
      <span>正在检测 Safari 设置…</span>
    </div>
  );

  const renderSafariFound = () => (
    <div>
      <div style={styles.statusBox}>
        <div style={styles.foundTitle}>找到页面：</div>
        <div style={styles.foundUrl}>{safariTab!.url}</div>
        <div style={styles.checkMark}>✅ Safari 设置正常</div>
      </div>
      <button style={styles.primaryBtn} onClick={handleConfirmSafariRead}>
        确认并读取限额数据
      </button>
      <div style={styles.hint}>
        将激活 Safari 窗口并读取页面中可见的文本内容，不会重新加载页面或访问你的登录信息。
      </div>
      <button style={styles.linkBtn} onClick={switchToManual}>
        还是手动输入
      </button>
    </div>
  );

  const renderSafariJsDisabled = () => (
    <div>
      <div style={styles.errorBox}>
        <div style={styles.errorTitle}>Safari 设置需要调整</div>
        <div style={styles.errorDetail}>{jsDisabledMessage}</div>
      </div>
      <div style={styles.instructionBox}>
        <div style={styles.instructionTitle}>如何开启：</div>
        <ol style={styles.instructionList}>
          <li>打开 Safari</li>
          <li>菜单栏 Safari → 设置 → 高级</li>
          <li>勾选「在菜单栏中显示功能栏」</li>
          <li>菜单栏 开发 → 勾选「允许 Apple Events 执行 JavaScript」</li>
        </ol>
        <div style={styles.instructionNote}>
          设置完成后，点击下方按钮重试。只需设置一次。
        </div>
      </div>
      <button style={styles.primaryBtn} onClick={handleSafariCapture}>
        设置好了，重新检测
      </button>
      <button style={styles.linkBtn} onClick={switchToManual}>
        还是手动输入
      </button>
    </div>
  );

  const renderSafariReading = () => (
    <div style={styles.statusBox}>
      <span>正在读取页面文本…</span>
    </div>
  );

  const renderSafariParsed = () => (
    <div>
      <div style={styles.statusBox} className="success">
        <div style={styles.foundTitle}>解析到以下限额数据：</div>
        {parsedLimits!.map((l, i) => (
          <div key={i} style={styles.parsedItem}>
            <span style={styles.parsedWindow}>{l.window}</span>
            <span style={styles.parsedValue}>
              {formatLimitValue(l)}
            </span>
            {l.confidence < 0.8 && (
              <span style={styles.lowConfidence}>（待确认）</span>
            )}
          </div>
        ))}
        {capturedText && (
          <details style={styles.rawText}>
            <summary>查看页面文本片段</summary>
            <pre style={styles.rawPre}>{capturedText.slice(0, 500)}</pre>
          </details>
        )}
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Plan</label>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          style={styles.select}
        >
          <option>ChatGPT Plus</option>
          <option>ChatGPT Pro</option>
          <option>Codex</option>
        </select>
      </div>
      <div style={styles.btnRow}>
        <button style={styles.primaryBtn} onClick={handleSaveParsed} disabled={saving}>
          {saving ? '保存中…' : '确认并保存'}
        </button>
        <button style={styles.linkBtn} onClick={switchToManual}>
          数据不对，手动修改
        </button>
      </div>
    </div>
  );

  const renderSafariParseFailed = () => (
    <div>
      <div style={styles.errorBox}>
        <div style={styles.errorTitle}>⚠️ 未能解析到限额数据</div>
        <div style={styles.errorDetail}>
          页面文本已读取，但其中的限额格式暂未识别。
        </div>
      </div>
      {parserDiagnostics && (
        <div style={styles.statusBox}>
          <div style={styles.foundTitle}>诊断信息</div>
          <div style={styles.diagnosticLine}>Trace: {parserDiagnostics.trace_id}</div>
          <div style={styles.diagnosticLine}>
            文本：{parserDiagnostics.text_length} 字符，{parserDiagnostics.line_count} 行
          </div>
          <div style={styles.diagnosticLine}>
            策略：{parserDiagnostics.strategies_tried.join(', ')}
          </div>
          <div style={styles.diagnosticLine}>
            失败原因：{parserDiagnostics.failure_reason || 'unknown'}
          </div>
          {parserDiagnostics.candidate_lines.length > 0 && (
            <details style={styles.rawText}>
              <summary>查看候选行</summary>
              <div>
                {parserDiagnostics.candidate_lines.map((line) => (
                  <div key={`${line.line_no}-${line.reason}`} style={styles.candidateLine}>
                    <span>#{line.line_no} {line.reason}: </span>
                    <span>{line.snippet}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <div style={styles.hint}>
        默认只保存诊断元数据。完整页面文本只会在你明确选择导出时写入诊断包。
      </div>
      {debugBundlePath && (
        <div style={styles.successBox}>
          <div style={styles.bundleTitle}>诊断包已导出</div>
          <div style={styles.bundlePath} title={debugBundlePath}>
            {debugBundlePath}
          </div>
          <div style={styles.bundleActions}>
            <button style={styles.smallBtn} onClick={handleCopyDebugBundlePath}>
              {debugBundlePathCopied ? '已复制路径' : '复制路径'}
            </button>
            <button style={styles.smallBtn} onClick={handleRevealDebugBundle}>
              在 Finder 中显示
            </button>
          </div>
        </div>
      )}
      <button style={styles.secondaryBtn} onClick={handleCopyDiagnosticSummary}>
        {diagnosticSummaryCopied ? '已复制诊断摘要' : '复制诊断摘要'}
      </button>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={styles.secondaryBtn} onClick={switchToManual}>
          手动输入
        </button>
        <button style={styles.primaryBtn} onClick={handleSafariCapture}>
          重新读取
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button style={styles.secondaryBtn} onClick={() => handleExportDiagnostics(false)}>
          导出诊断包
        </button>
        <button style={styles.dangerOutlineBtn} onClick={() => handleExportDiagnostics(true)}>
          导出含完整文本
        </button>
      </div>
    </div>
  );

  const renderManualForm = () => (
    <div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Plan</label>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          style={styles.select}
        >
          <option>ChatGPT Plus</option>
          <option>ChatGPT Pro</option>
          <option>Codex</option>
        </select>
      </div>

      {manualLimits.map((l, i) => (
        <div key={i} style={styles.limitRow}>
          <select
            value={l.window}
            onChange={(e) => updateManualLimit(i, 'window', e.target.value)}
            style={styles.windowSelect}
          >
            <option value="5h">5 小时</option>
            <option value="3h">3 小时</option>
            <option value="day">每天</option>
            <option value="week">每周</option>
            <option value="month">每月</option>
          </select>
          <input
            type="number"
            value={l.used || ''}
            onChange={(e) => updateManualLimit(i, 'used', parseInt(e.target.value) || 0)}
            placeholder="已用"
            style={styles.numInput}
          />
          <span style={styles.slash}>/</span>
          <input
            type="number"
            value={l.total || ''}
            onChange={(e) => updateManualLimit(i, 'total', parseInt(e.target.value) || 0)}
            placeholder="总额"
            style={styles.numInput}
          />
          <select
            value={l.unit}
            onChange={(e) => updateManualLimit(i, 'unit', e.target.value)}
            style={styles.unitSelect}
          >
            <option value="tokens">tokens</option>
            <option value="messages">messages</option>
            <option value="requests">requests</option>
          </select>
        </div>
      ))}

      <button style={styles.addBtn} onClick={addManualLimit}>
        + 添加限额窗口
      </button>

      <div style={styles.btnRow}>
        <button style={styles.primaryBtn} onClick={handleSaveManual} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );

  // Headless quick-refresh: render nothing while auto-capture is progressing.
  // Exception: show UI during countdown (parsed results) and on errors.
  const isHeadlessRunning = quickRefreshRef.current &&
    ['safari-searching', 'safari-probing', 'safari-reading', 'saving'].includes(mode) &&
    autoSaveCountdown === null;

  if (isHeadlessRunning) return null;

  const handleCancelAutoSave = () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setAutoSaveCountdown(null);
    quickRefreshRef.current = false;
    setMode('safari-parsed');
  };

  return (
    <div style={styles.container}>
      {!quickRefresh && (
        <div style={styles.header}>
          <span style={styles.title}>ChatGPT / Codex 限额录入</span>
        </div>
      )}

      {autoSaveCountdown !== null && parsedLimits && (
        <div style={styles.countdownBanner}>
          <div style={styles.countdownText}>
            {autoSaveCountdown > 0
              ? `${autoSaveCountdown} 秒后自动保存…`
              : '正在保存…'}
          </div>
          <div style={styles.countdownResults}>
            {parsedLimits.map((l, i) => (
              <span key={i} style={styles.countdownItem}>
                {l.window} {formatLimitValue(l)}
              </span>
            ))}
          </div>
          <button style={styles.countdownCancel} onClick={handleCancelAutoSave}>
            取消自动保存
          </button>
        </div>
      )}

      {!autoSaveCountdown && error && (
        <div style={styles.errorBox}>
          <span>{error}</span>
          <button style={styles.dismissBtn} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {autoSaveCountdown === null && (
        <>
          {mode === 'idle' && renderIdle()}
          {mode === 'safari-searching' && renderSafariSearching()}
          {mode === 'safari-probing' && renderSafariProbing()}
          {mode === 'safari-found' && renderSafariFound()}
          {mode === 'safari-js-disabled' && renderSafariJsDisabled()}
          {mode === 'safari-reading' && renderSafariReading()}
          {mode === 'safari-parsed' && renderSafariParsed()}
          {mode === 'safari-parse-failed' && renderSafariParseFailed()}
          {mode === 'manual-form' && renderManualForm()}
        </>
      )}
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatLimitValue(limit: ParsedLimit): string {
  if (limit.remaining !== undefined && limit.unit === 'percent') {
    return `${limit.remaining}% remaining`;
  }
  return `${formatNum(limit.used)} / ${formatNum(limit.total)} ${limit.unit}`;
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 0 16px 0' },
  header: { marginBottom: 12 },
  title: { fontSize: 14, fontWeight: 700, color: '#1d1d1f' },
  errorBox: {
    background: '#fbe9e7', color: '#c62828', fontSize: 12, padding: '8px 10px',
    borderRadius: 6, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  successBox: {
    background: '#e8f5e9', color: '#2e7d32', fontSize: 11, padding: '8px 10px',
    borderRadius: 6, marginTop: 8, wordBreak: 'break-all',
  },
  bundleTitle: { fontSize: 11, fontWeight: 600, marginBottom: 4 },
  bundlePath: {
    fontSize: 10, lineHeight: 1.35, maxHeight: 42, overflow: 'hidden',
    userSelect: 'text', wordBreak: 'break-all',
  },
  bundleActions: { display: 'flex', gap: 6, marginTop: 8 },
  smallBtn: {
    flex: 1, padding: '6px 4px', fontSize: 11, color: '#007aff',
    background: '#ffffff', border: '1px solid #007aff', borderRadius: 6, cursor: 'pointer',
    textAlign: 'center',
  },
  dismissBtn: { background: 'none', border: 'none', color: '#c62828', cursor: 'pointer', fontSize: 14 },
  primaryBtn: {
    width: '100%', padding: '10px 0', fontSize: 13, fontWeight: 600, color: '#ffffff',
    background: '#007aff', border: 'none', borderRadius: 6, cursor: 'pointer', marginBottom: 8,
    textAlign: 'center',
  },
  secondaryBtn: {
    width: '100%', padding: '8px 0', fontSize: 13, color: '#007aff',
    background: 'none', border: '1px solid #007aff', borderRadius: 6, cursor: 'pointer',
    textAlign: 'center',
  },
  dangerOutlineBtn: {
    width: '100%', padding: '8px 0', fontSize: 13, color: '#c62828',
    background: 'none', border: '1px solid #c62828', borderRadius: 6, cursor: 'pointer',
    textAlign: 'center',
  },
  linkBtn: {
    background: 'none', border: 'none', color: '#007aff', fontSize: 12, cursor: 'pointer',
    padding: '4px 0', display: 'block', width: '100%', textAlign: 'center', marginTop: 4,
  },
  hint: { fontSize: 11, color: '#86868b', textAlign: 'center', marginTop: 6, lineHeight: 1.4 },
  divider: { display: 'flex', alignItems: 'center', margin: '12px 0' },
  dividerText: { flex: 1, textAlign: 'center', fontSize: 11, color: '#aeaeb2' },
  statusBox: {
    background: '#f5f5f7', borderRadius: 8, padding: '12px 14px', marginBottom: 12,
    fontSize: 13, color: '#1d1d1f',
  },
  foundTitle: { fontSize: 12, fontWeight: 600, marginBottom: 4 },
  foundUrl: { fontSize: 11, color: '#86868b', wordBreak: 'break-all' },
  parsedItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 },
  parsedWindow: { fontWeight: 600, minWidth: 40, color: '#007aff' },
  parsedValue: { color: '#1d1d1f' },
  lowConfidence: { fontSize: 11, color: '#e65100' },
  rawText: { marginTop: 8, fontSize: 11 },
  rawPre: { fontSize: 10, color: '#86868b', maxHeight: 150, overflow: 'auto', background: '#fff', padding: 6, borderRadius: 4 },
  diagnosticLine: { fontSize: 11, color: '#515154', marginTop: 3, wordBreak: 'break-word' },
  candidateLine: { fontSize: 10, color: '#515154', marginTop: 4, lineHeight: 1.4 },
  formGroup: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 600, color: '#1d1d1f', display: 'block', marginBottom: 4 },
  select: {
    width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d2d2d7',
    borderRadius: 6, background: '#fff',
  },
  limitRow: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
  },
  windowSelect: {
    padding: '6px 4px', fontSize: 13, border: '1px solid #d2d2d7', borderRadius: 6, background: '#fff', width: 70,
  },
  numInput: {
    width: 80, padding: '6px 6px', fontSize: 13, border: '1px solid #d2d2d7',
    borderRadius: 6, textAlign: 'right',
  },
  slash: { fontSize: 14, color: '#aeaeb2' },
  unitSelect: {
    padding: '6px 4px', fontSize: 13, border: '1px solid #d2d2d7', borderRadius: 6, background: '#fff', width: 80,
  },
  addBtn: {
    background: 'none', border: '1px dashed #d2d2d7', color: '#007aff', fontSize: 12,
    padding: '6px 0', borderRadius: 6, cursor: 'pointer', width: '100%', marginBottom: 12,
  },
  btnRow: { marginTop: 8 },
  countdownBanner: {
    background: '#e8f5e9', borderRadius: 10, padding: '16px 14px', marginBottom: 12,
    textAlign: 'center',
  },
  countdownText: { fontSize: 16, fontWeight: 700, color: '#2e7d32', marginBottom: 8 },
  countdownResults: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 10 },
  countdownItem: { fontSize: 13, color: '#1d1d1f', fontWeight: 500 },
  countdownCancel: {
    background: 'none', border: '1px solid #c62828', color: '#c62828',
    fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
  },
  checkMark: { fontSize: 12, color: '#2e7d32', marginTop: 6 },
  errorTitle: { fontSize: 12, fontWeight: 600, color: '#c62828', marginBottom: 4 },
  errorDetail: { fontSize: 12, color: '#c62828', lineHeight: 1.4, whiteSpace: 'pre-wrap' },
  instructionBox: {
    background: '#e3f2fd', borderRadius: 8, padding: '12px 14px', marginBottom: 12,
  },
  instructionTitle: { fontSize: 12, fontWeight: 600, color: '#1565c0', marginBottom: 6 },
  instructionList: { fontSize: 12, color: '#1d1d1f', paddingLeft: 18, lineHeight: 1.6, margin: 0 },
  instructionNote: { fontSize: 11, color: '#1565c0', marginTop: 6 },
};
