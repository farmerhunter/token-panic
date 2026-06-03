export type DiagnosticStatus = 'ok' | 'warning' | 'error' | 'user_cancelled';

export type DiagnosticComponent =
  | 'safari_capture'
  | 'text_parser'
  | 'manual_snapshot'
  | 'debug_bundle';

export type DiagnosticFailureReason =
  | 'safari_not_running'
  | 'tab_not_found'
  | 'url_not_allowed'
  | 'apple_events_denied'
  | 'javascript_probe_failed'
  | 'js_not_enabled'
  | 'permission_denied'
  | 'read_failed'
  | 'empty_page_text'
  | 'empty_text'
  | 'no_limit_candidates'
  | 'candidate_lines_found_but_no_valid_limit'
  | 'manual_confirmation_required'
  | 'raw_cache_expired'
  | 'bundle_export_failed'
  | 'parse_failed';

export type DiagnosticEvent = {
  trace_id: string;
  ts: string;
  component: DiagnosticComponent;
  phase: string;
  status: DiagnosticStatus;
  metadata?: Record<string, unknown>;
  error?: {
    type: DiagnosticFailureReason | string;
    message: string;
  };
};

export type ParserCandidateLine = {
  line_no: number;
  snippet: string;
  reason: string;
};

export type ParserDiagnostics = {
  trace_id?: string;
  text_length: number;
  line_count: number;
  strategies_tried: string[];
  candidate_lines: ParserCandidateLine[];
  failure_reason?: DiagnosticFailureReason;
};

export type DebugBundleRequest = {
  trace_id: string;
  parser_diagnostics?: ParserDiagnostics;
  include_raw_text: boolean;
  capture_method?: string;
};

export type DebugBundleResult = {
  success: boolean;
  path?: string;
  error?: string;
  reason?: DiagnosticFailureReason;
};

export type DebugBundleManifest = {
  schema_version: 1;
  trace_id: string;
  created_at: string;
  capture_method: string;
  include_raw_text: boolean;
  contains_sensitive_data: boolean;
  files: string[];
};

export function createDebugBundleManifest(input: {
  trace_id: string;
  created_at: string;
  capture_method?: string;
  include_raw_text: boolean;
  has_parser_diagnostics: boolean;
}): DebugBundleManifest {
  const files = ['manifest.json', 'environment.json', 'trace.jsonl'];
  if (input.has_parser_diagnostics) files.push('parser-diagnostics.json');
  if (input.include_raw_text) files.push('raw-text.txt');

  return {
    schema_version: 1,
    trace_id: input.trace_id,
    created_at: input.created_at,
    capture_method: input.capture_method || 'unknown',
    include_raw_text: input.include_raw_text,
    contains_sensitive_data: input.include_raw_text,
    files,
  };
}

export function formatDiagnosticSummary(input: {
  trace_id?: string | null;
  parser_diagnostics?: ParserDiagnostics | null;
  bundle_path?: string | null;
  raw_text_included?: boolean;
}): string {
  const diagnostics = input.parser_diagnostics;
  const lines = [
    'token-panic diagnostic summary',
    `trace_id: ${input.trace_id || diagnostics?.trace_id || 'unknown'}`,
  ];

  if (diagnostics) {
    lines.push(
      `failure_reason: ${diagnostics.failure_reason || 'none'}`,
      `text_length: ${diagnostics.text_length}`,
      `line_count: ${diagnostics.line_count}`,
      `strategies_tried: ${diagnostics.strategies_tried.join(', ') || 'none'}`,
      `candidate_count: ${diagnostics.candidate_lines.length}`,
    );

    if (diagnostics.candidate_lines.length > 0) {
      lines.push('candidate_lines:');
      for (const candidate of diagnostics.candidate_lines) {
        lines.push(`- #${candidate.line_no} ${candidate.reason}: ${candidate.snippet}`);
      }
    }
  }

  if (input.bundle_path) lines.push(`bundle_path: ${input.bundle_path}`);
  lines.push(`raw_text_included: ${input.raw_text_included ? 'true' : 'false'}`);

  return lines.join('\n');
}
