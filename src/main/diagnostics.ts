import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type {
  DebugBundleRequest,
  DebugBundleResult,
  DiagnosticEvent,
} from '../shared/diagnostics';
import { createDebugBundleManifest } from '../shared/diagnostics';

type RawCaptureEntry = {
  trace_id: string;
  text: string;
  source_url: string;
  captured_at: string;
  expires_at: number;
};

const RAW_CACHE_TTL_MS = 10 * 60 * 1000;
const RAW_CACHE_LIMIT = 3;
const rawCache = new Map<string, RawCaptureEntry>();

let diagnosticsDir: string | null = null;

export function createTraceId(prefix: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${prefix}_${timestamp}_${suffix}`;
}

function getDiagnosticsDir(): string {
  if (!diagnosticsDir) {
    try {
      diagnosticsDir = path.join(app.getPath('userData'), 'debug');
    } catch {
      diagnosticsDir = '/tmp/token-panic-debug';
    }
  }
  return diagnosticsDir;
}

function pruneRawCache(now = Date.now()): void {
  for (const [traceId, entry] of rawCache.entries()) {
    if (entry.expires_at <= now) {
      rawCache.delete(traceId);
    }
  }

  while (rawCache.size > RAW_CACHE_LIMIT) {
    const oldest = [...rawCache.values()].sort((a, b) => a.expires_at - b.expires_at)[0];
    if (!oldest) break;
    rawCache.delete(oldest.trace_id);
  }
}

export function storeRawCapture(entry: Omit<RawCaptureEntry, 'expires_at'>): void {
  pruneRawCache();
  rawCache.set(entry.trace_id, {
    ...entry,
    expires_at: Date.now() + RAW_CACHE_TTL_MS,
  });
  pruneRawCache();
}

export function getRawCapture(traceId: string): RawCaptureEntry | null {
  pruneRawCache();
  return rawCache.get(traceId) ?? null;
}

export function logDiagnosticEvent(event: Omit<DiagnosticEvent, 'ts'>): void {
  const fullEvent: DiagnosticEvent = {
    ...event,
    ts: new Date().toISOString(),
  };

  try {
    const dir = getDiagnosticsDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'diagnostics.jsonl'),
      `${JSON.stringify(fullEvent)}\n`,
      'utf-8',
    );
  } catch (err) {
    console.error('[diagnostics] failed to write event:', err);
  }
}

function safeTracePath(traceId: string): string {
  return traceId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function readTraceEvents(traceId: string): string {
  const logPath = path.join(getDiagnosticsDir(), 'diagnostics.jsonl');
  if (!fs.existsSync(logPath)) return '';

  return fs.readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        return JSON.parse(line).trace_id === traceId;
      } catch {
        return false;
      }
    })
    .join('\n');
}

export function exportDebugBundle(request: DebugBundleRequest): DebugBundleResult {
  try {
    if (request.include_raw_text && !getRawCapture(request.trace_id)) {
      logDiagnosticEvent({
        trace_id: request.trace_id,
        component: 'debug_bundle',
        phase: 'export',
        status: 'error',
        error: {
          type: 'raw_cache_expired',
          message: 'Raw capture cache expired before debug bundle export',
        },
      });
      return {
        success: false,
        reason: 'raw_cache_expired',
        error: '完整页面文本已过期，请重新读取页面后导出。',
      };
    }

    const dir = path.join(getDiagnosticsDir(), `debug-bundle-${safeTracePath(request.trace_id)}`);
    fs.mkdirSync(dir, { recursive: true });
    const exportedAt = new Date().toISOString();

    const manifest = createDebugBundleManifest({
      trace_id: request.trace_id,
      created_at: exportedAt,
      capture_method: request.capture_method,
      include_raw_text: request.include_raw_text,
      has_parser_diagnostics: Boolean(request.parser_diagnostics),
    });

    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );

    const environment = {
      app_name: 'token-panic',
      app_version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
      electron_version: process.versions.electron,
      exported_at: exportedAt,
      trace_id: request.trace_id,
      raw_text_included: request.include_raw_text,
    };

    fs.writeFileSync(
      path.join(dir, 'environment.json'),
      JSON.stringify(environment, null, 2),
      'utf-8',
    );

    const traceEvents = readTraceEvents(request.trace_id);
    fs.writeFileSync(
      path.join(dir, 'trace.jsonl'),
      traceEvents ? `${traceEvents}\n` : '',
      'utf-8',
    );

    if (request.parser_diagnostics) {
      fs.writeFileSync(
        path.join(dir, 'parser-diagnostics.json'),
        JSON.stringify(request.parser_diagnostics, null, 2),
        'utf-8',
      );
    }

    if (request.include_raw_text) {
      const raw = getRawCapture(request.trace_id);
      if (!raw) throw new Error('raw cache expired after preflight');

      fs.writeFileSync(
        path.join(dir, 'raw-text.txt'),
        `# URL: ${raw.source_url}\n# Captured at: ${raw.captured_at}\n# Trace ID: ${raw.trace_id}\n\n${raw.text}`,
        'utf-8',
      );
    }

    logDiagnosticEvent({
      trace_id: request.trace_id,
      component: 'debug_bundle',
      phase: 'export',
      status: 'ok',
      metadata: {
        path: dir,
        raw_text_included: request.include_raw_text,
        files: manifest.files,
      },
    });

    return { success: true, path: dir };
  } catch (err: any) {
    logDiagnosticEvent({
      trace_id: request.trace_id,
      component: 'debug_bundle',
      phase: 'export',
      status: 'error',
      error: {
        type: 'bundle_export_failed',
        message: err.message,
      },
    });
    return { success: false, reason: 'bundle_export_failed', error: err.message };
  }
}
