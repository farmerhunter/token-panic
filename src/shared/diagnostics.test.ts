import { describe, expect, it } from 'vitest';
import { createDebugBundleManifest, formatDiagnosticSummary } from './diagnostics';
import type { ParserDiagnostics } from './diagnostics';

describe('diagnostics', () => {
  it('should create a debug bundle manifest without raw text by default', () => {
    const manifest = createDebugBundleManifest({
      trace_id: 'trace-1',
      created_at: '2026-06-02T00:00:00.000Z',
      capture_method: 'safari_visible_tab',
      include_raw_text: false,
      has_parser_diagnostics: true,
    });

    expect(manifest.schema_version).toBe(1);
    expect(manifest.trace_id).toBe('trace-1');
    expect(manifest.capture_method).toBe('safari_visible_tab');
    expect(manifest.contains_sensitive_data).toBe(false);
    expect(manifest.files).toEqual([
      'manifest.json',
      'environment.json',
      'trace.jsonl',
      'parser-diagnostics.json',
    ]);
  });

  it('should include raw-text.txt and mark sensitive data when raw text is exported', () => {
    const manifest = createDebugBundleManifest({
      trace_id: 'trace-raw',
      created_at: '2026-06-02T00:00:00.000Z',
      include_raw_text: true,
      has_parser_diagnostics: false,
    });

    expect(manifest.capture_method).toBe('unknown');
    expect(manifest.contains_sensitive_data).toBe(true);
    expect(manifest.files).toContain('raw-text.txt');
    expect(manifest.files).not.toContain('parser-diagnostics.json');
  });

  it('should format an agent handoff diagnostic summary', () => {
    const diagnostics: ParserDiagnostics = {
      trace_id: 'trace-summary',
      text_length: 1200,
      line_count: 42,
      strategies_tried: ['same_line_window_pair', 'nearby_window_pair'],
      failure_reason: 'candidate_lines_found_but_no_valid_limit',
      candidate_lines: [
        {
          line_no: 7,
          reason: 'window_match_without_number_pair',
          snippet: '5 hours limit',
        },
      ],
    };

    const summary = formatDiagnosticSummary({
      parser_diagnostics: diagnostics,
      bundle_path: '/tmp/debug-bundle-trace-summary',
      raw_text_included: false,
    });

    expect(summary).toContain('trace_id: trace-summary');
    expect(summary).toContain('failure_reason: candidate_lines_found_but_no_valid_limit');
    expect(summary).toContain('candidate_count: 1');
    expect(summary).toContain('- #7 window_match_without_number_pair: 5 hours limit');
    expect(summary).toContain('raw_text_included: false');
  });
});
