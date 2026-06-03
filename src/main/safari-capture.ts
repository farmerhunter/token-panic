// ============================================================
// Safari visible-tab assisted capture — Phase 3.
//
// Uses AppleScript to find and read from an already-open,
// already-logged-in Safari tab. Zero new network requests,
// zero page modification, zero cookie/storageState access.
//
// See DD-015 for the full staged approach and safety rules.
// ============================================================

import { execFile } from 'child_process';
import { createTraceId, logDiagnosticEvent, storeRawCapture } from './diagnostics';
import type { DiagnosticFailureReason } from '../shared/diagnostics';

// URL pattern to match. User must already have this tab open and logged in.
const ALLOWED_URL_PATTERN = 'chatgpt.com/codex/cloud/settings/analytics';

function urlMetadata(url: string): Record<string, string> {
  try {
    const parsed = new URL(url);
    return {
      url_host: parsed.host,
      url_path: parsed.pathname,
    };
  } catch {
    return {
      url_host: 'unknown',
      url_path: 'unknown',
    };
  }
}

export interface SafariTabInfo {
  name: string;
  url: string;
}

export interface CaptureResult {
  trace_id: string;
  text: string;
  diagnostics: {
    text_length: number;
    line_count: number;
  };
  source: {
    url: string;
    tabName: string;
    capturedAt: string;
  };
}

// ---- AppleScript execution ----

function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', script],
      { timeout: 10_000 }, // 10s timeout
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message));
        } else {
          resolve(stdout.trim());
        }
      },
    );
  });
}

// ---- Step 1: Find matching tab (zero network, zero page interaction) ----

/**
 * List Safari tabs and find one matching the allowed URL pattern.
 * Does NOT activate Safari, reload pages, or execute JavaScript.
 * Returns null if no matching tab found or if Safari isn't running.
 */
export async function findSafariAnalyticsTab(): Promise<SafariTabInfo | null> {
  const traceId = createTraceId('safari_find');
  try {
    const script = `
      tell application "Safari"
        if not (exists (windows where its visible is true)) then
          return ""
        end if
        repeat with w in windows
          repeat with t in tabs of w
            if URL of t contains "${ALLOWED_URL_PATTERN}" then
              return name of t & "|" & URL of t
            end if
          end repeat
        end repeat
        return ""
      end tell
    `;

    const result = await runAppleScript(script);

    if (!result) {
      logDiagnosticEvent({
        trace_id: traceId,
        component: 'safari_capture',
        phase: 'find_tab',
        status: 'error',
        error: {
          type: 'tab_not_found',
          message: 'No matching Safari analytics tab found',
        },
      });
      return null;
    }

    const [name, ...urlParts] = result.split('|');
    const url = urlParts.join('|'); // URL may contain |

    const tab = { name: name.trim(), url: url.trim() };
    logDiagnosticEvent({
      trace_id: traceId,
      component: 'safari_capture',
      phase: 'find_tab',
      status: 'ok',
      metadata: {
        matched: true,
        ...urlMetadata(tab.url),
      },
    });
    return tab;
  } catch (err: any) {
    // Safari not running, no permission, or AppleScript error
    logDiagnosticEvent({
      trace_id: traceId,
      component: 'safari_capture',
      phase: 'find_tab',
      status: 'error',
      error: {
        type: classifySafariError(err),
        message: err.message,
      },
    });
    return null;
  }
}

// ---- Step 1.5: Probe JS capability (before user confirms) ----

export interface ProbeResult {
  jsEnabled: boolean;
  errorType?: SafariCaptureError;
  errorMessage?: string;
}

/**
 * Test whether Safari's "Allow JavaScript from Apple Events" is enabled
 * by running a trivial no-op expression. Must be called AFTER finding a tab
 * (the tab must exist or this won't test the right thing).
 *
 * This does NOT read page content — it just evaluates "true".
 */
export async function probeSafariJavaScript(): Promise<ProbeResult> {
  const traceId = createTraceId('safari_probe');
  try {
    const script = `
      tell application "Safari"
        repeat with w in windows
          repeat with t in tabs of w
            if URL of t contains "${ALLOWED_URL_PATTERN}" then
              tell t to do JavaScript "true"
              return "ok"
            end if
          end repeat
        end repeat
        return "no-tab"
      end tell
    `;

    const result = await runAppleScript(script);

    if (result === 'ok') {
      logDiagnosticEvent({
        trace_id: traceId,
        component: 'safari_capture',
        phase: 'probe_js',
        status: 'ok',
      });
      return { jsEnabled: true };
    }

    if (result === 'no-tab') {
      logDiagnosticEvent({
        trace_id: traceId,
        component: 'safari_capture',
        phase: 'probe_js',
        status: 'error',
        error: {
          type: 'tab_not_found',
          message: 'No matching Safari analytics tab found during JS probe',
        },
      });
      return {
        jsEnabled: false,
        errorType: 'tab_not_found',
        errorMessage: 'ChatGPT analytics 页面已关闭，请重新打开',
      };
    }

    // AppleScript returned something unexpected — likely the tab lookup failed silently
    return {
      jsEnabled: false,
      errorType: 'read_failed',
      errorMessage: '无法探测 Safari JS 能力',
    };
  } catch (err: any) {
    const errorType = classifySafariError(err);
    const messages: Record<SafariCaptureError, string> = {
      safari_not_running: 'Safari 未运行',
      tab_not_found: '未找到 ChatGPT analytics 页面',
      js_not_enabled: '需要开启 Safari 开发菜单中的「允许 Apple Events 执行 JavaScript」。\n\n设置方法：Safari → 设置 → 高级 → 勾选「在菜单栏中显示功能栏」→ 菜单栏「开发」→ 勾选「允许 Apple Events 执行 JavaScript」',
      apple_events_denied: '需要授予自动化权限。请在系统设置 → 隐私与安全性 → 自动化中允许本应用控制 Safari。',
      read_failed: 'Safari JS 探测失败',
    };
    logDiagnosticEvent({
      trace_id: traceId,
      component: 'safari_capture',
      phase: 'probe_js',
      status: 'error',
      error: {
        type: errorType,
        message: err.message,
      },
    });
    return {
      jsEnabled: false,
      errorType,
      errorMessage: messages[errorType] || err.message,
    };
  }
}

// ---- Step 2: Read visible text (user must confirm first) ----

/**
 * Read ONLY document.body.innerText from the already-open analytics tab.
 *
 * Safety: this activates the tab (brings it to front) and executes a
 * read-only JS expression. It does NOT:
 * - Reload or navigate the page
 * - Access cookies, localStorage, or sessionStorage
 * - Inject or modify any page content
 * - Submit any form or click any button
 *
 * Requirements:
 * - Safari must be running with the analytics tab open
 * - Safari Develop menu > "Allow JavaScript from Apple Events" must be enabled
 * - macOS Automation permission for the calling app must be granted
 *
 * Returns null if any step fails.
 */
export async function readSafariTabText(): Promise<CaptureResult | null> {
  const traceId = createTraceId('safari_capture');
  try {
    // Step 2a: Re-find the tab (safety: no URL guessing)
    const tab = await findSafariAnalyticsTab();
    if (!tab) {
      logDiagnosticEvent({
        trace_id: traceId,
        component: 'safari_capture',
        phase: 'read_text',
        status: 'error',
        error: {
          type: 'tab_not_found',
          message: 'No matching Safari analytics tab found before read',
        },
      });
      return null;
    }

    // Step 2b: Activate Safari, switch to the tab, read innerText
    const script = `
      tell application "Safari"
        activate
        repeat with w in windows
          repeat with t in tabs of w
            if URL of t contains "${ALLOWED_URL_PATTERN}" then
              set current tab of w to t
              set index of w to 1
              tell t to do JavaScript "document.body.innerText"
              return result
            end if
          end repeat
        end repeat
        return ""
      end tell
    `;

    const text = await runAppleScript(script);

    if (!text) {
      logDiagnosticEvent({
        trace_id: traceId,
        component: 'safari_capture',
        phase: 'read_text',
        status: 'error',
      error: {
        type: 'empty_page_text',
        message: 'Safari returned empty page text',
      },
      });
      return null;
    }

    const capturedAt = new Date().toISOString();
    const lineCount = text.split('\n').length;
    storeRawCapture({
      trace_id: traceId,
      text,
      source_url: tab.url,
      captured_at: capturedAt,
    });
    logDiagnosticEvent({
      trace_id: traceId,
      component: 'safari_capture',
      phase: 'read_text',
      status: 'ok',
      metadata: {
        text_length: text.length,
        line_count: lineCount,
        ...urlMetadata(tab.url),
      },
    });

    return {
      trace_id: traceId,
      text,
      diagnostics: {
        text_length: text.length,
        line_count: lineCount,
      },
      source: {
        url: tab.url,
        tabName: tab.name,
        capturedAt,
      },
    };
  } catch (err: any) {
    logDiagnosticEvent({
      trace_id: traceId,
      component: 'safari_capture',
      phase: 'read_text',
      status: 'error',
      error: {
        type: classifySafariError(err),
        message: err.message,
      },
    });
    return null;
  }
}

// ---- Error classification for UI feedback ----

export type SafariCaptureError =
  | 'safari_not_running'
  | 'tab_not_found'
  | 'js_not_enabled'
  | 'apple_events_denied'
  | 'read_failed';

export function classifySafariError(err: Error): SafariCaptureError {
  const msg = err.message.toLowerCase();
  if (msg.includes('not running') || msg.includes('-1728')) return 'safari_not_running';
  if (msg.includes('not allowed') || msg.includes('-10004')) return 'js_not_enabled';
  if (msg.includes('permission') || msg.includes('-1743')) return 'apple_events_denied';
  return 'read_failed';
}

const _safariErrorCheck: Record<SafariCaptureError, DiagnosticFailureReason> = {
  safari_not_running: 'safari_not_running',
  tab_not_found: 'tab_not_found',
  js_not_enabled: 'js_not_enabled',
  apple_events_denied: 'apple_events_denied',
  read_failed: 'read_failed',
};

void _safariErrorCheck;
