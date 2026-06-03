import { describe, it, expect } from 'vitest';
import { parseLimitText, parseLimitTextWithDiagnostics } from './text-parser';

describe('parseLimitText', () => {
  it('should return null for empty text', () => {
    expect(parseLimitText('')).toBeNull();
    expect(parseLimitText('   ')).toBeNull();
  });

  it('should parse "5h 1.2M/2M" format', () => {
    const text = '5h 1.2M/2M tokens';
    const result = parseLimitText(text);
    expect(result).not.toBeNull();
    expect(result!.limits).toHaveLength(1);
    expect(result!.limits[0].window).toBe('5h');
    expect(result!.limits[0].used).toBe(1_200_000);
    expect(result!.limits[0].total).toBe(2_000_000);
    expect(result!.limits[0].unit).toBe('tokens');
  });

  it('should parse multiple windows', () => {
    const text = `
5h 1.2M/2M
Weekly 3.8M/10M tokens
    `;
    const result = parseLimitText(text);
    expect(result).not.toBeNull();
    expect(result!.limits).toHaveLength(2);
    expect(result!.limits[0].window).toBe('5h');
    expect(result!.limits[1].window).toBe('week');
  });

  it('should parse comma-separated numbers', () => {
    const text = '5 hours: 1,200,000 / 2,000,000 messages';
    const result = parseLimitText(text);
    expect(result).not.toBeNull();
    expect(result!.limits[0].used).toBe(1_200_000);
    expect(result!.limits[0].total).toBe(2_000_000);
    expect(result!.limits[0].unit).toBe('messages');
  });

  it('should parse "of" format', () => {
    const text = 'Daily: 120K of 500K requests';
    const result = parseLimitText(text);
    expect(result).not.toBeNull();
    expect(result!.limits[0].window).toBe('day');
    expect(result!.limits[0].used).toBe(120_000);
    expect(result!.limits[0].total).toBe(500_000);
    expect(result!.limits[0].unit).toBe('requests');
  });

  it('should parse K suffix', () => {
    const text = '5h 380K/2M';
    const result = parseLimitText(text);
    expect(result).not.toBeNull();
    expect(result!.limits[0].used).toBe(380_000);
    expect(result!.limits[0].total).toBe(2_000_000);
  });

  it('should return null for text without recognizable patterns', () => {
    const text = 'Welcome to ChatGPT! How can I help you today?';
    expect(parseLimitText(text)).toBeNull();
  });

  it('should return parser diagnostics for failed parses', () => {
    const result = parseLimitTextWithDiagnostics('Usage limits\n5 hours\nNo quota numbers here', 'trace-test');
    expect(result.result).toBeNull();
    expect(result.diagnostics.trace_id).toBe('trace-test');
    expect(result.diagnostics.failure_reason).toBe('candidate_lines_found_but_no_valid_limit');
    expect(result.diagnostics.candidate_lines.length).toBeGreaterThan(0);
  });

  it('should return parser diagnostics for successful parses', () => {
    const result = parseLimitTextWithDiagnostics('5h 1.2M/2M tokens', 'trace-ok');
    expect(result.result).not.toBeNull();
    expect(result.diagnostics.trace_id).toBe('trace-ok');
    expect(result.diagnostics.text_length).toBeGreaterThan(0);
    expect(result.diagnostics.strategies_tried).toContain('same_line_window_pair');
  });

  it('should parse ChatGPT Codex percentage remaining sections', () => {
    const text = `
Balance
Codex usage draws from your shared agentic usage limit

5 hour usage limit
40%
remaining
Resets 2:21 PM
Weekly usage limit
86%
remaining
Resets Jun 8, 2026 10:59 AM
    `;

    const result = parseLimitTextWithDiagnostics(text, 'trace-percent');

    expect(result.result).not.toBeNull();
    expect(result.result!.limits).toHaveLength(2);
    expect(result.result!.limits[0]).toMatchObject({
      window: '5h',
      used: 60,
      total: 100,
      remaining: 40,
      unit: 'percent',
    });
    expect(result.result!.limits[1]).toMatchObject({
      window: 'week',
      used: 14,
      total: 100,
      remaining: 86,
      unit: 'percent',
    });
    expect(result.diagnostics.strategies_tried).toContain('section_percent_remaining');
    expect(result.diagnostics.failure_reason).toBeUndefined();
  });

  it('should associate window label from nearby line (strategy 2)', () => {
    const text = `
Usage limits
5 hours
1,200,000 / 2,000,000
    `;
    const result = parseLimitText(text);
    expect(result).not.toBeNull();
    // Strategy 2: finds window label in adjacent line
    const limit5h = result!.limits.find((l) => l.window === '5h');
    expect(limit5h).toBeDefined();
    expect(limit5h!.used).toBe(1_200_000);
    expect(limit5h!.confidence).toBe(0.5); // medium confidence (cross-line association)
  });

  it('should include raw_text_snippet', () => {
    const text = '5h 1M/2M tokens daily 500K/1M';
    const result = parseLimitText(text);
    expect(result).not.toBeNull();
    expect(result!.raw_text_snippet).toBeDefined();
  });

  it('should not duplicate the same window label', () => {
    const text = '5h 1.2M/2M\n5h 1.0M/2M'; // same window, different values
    const result = parseLimitText(text);
    expect(result).not.toBeNull();
    const fiveHourLimits = result!.limits.filter((l) => l.window === '5h');
    expect(fiveHourLimits).toHaveLength(1); // only first match
  });

  it('should parse Chinese window labels', () => {
    const text = '每日 120K/500K\n每周 3.8M/10M\n每月 15M/50M';
    const result = parseLimitText(text);
    expect(result).not.toBeNull();
    expect(result!.limits).toHaveLength(3);
    expect(result!.limits[0].window).toBe('day');
    expect(result!.limits[1].window).toBe('week');
    expect(result!.limits[2].window).toBe('month');
  });
});
