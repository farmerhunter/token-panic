// ============================================================
// Local text parser for ChatGPT/Codex limit data.
//
// Parses user-pasted or Safari-extracted visible text into
// candidate LimitPayload. Conservative: returns null if
// confidence is too low. See DD-013.
//
// This is a pure function — no network, no DOM, no file I/O.
// ============================================================

import type { LimitPayload } from '../shared/types';
import type { ParserCandidateLine, ParserDiagnostics } from '../shared/diagnostics';

export interface ParsedLimit {
  window: string;
  used: number;
  total: number;
  unit: string;
  remaining?: number;
  confidence: number; // 0-1
}

export interface LimitParseResult {
  limits: ParsedLimit[];
  raw_text_snippet?: string; // for user to verify
}

export interface LimitParseWithDiagnostics {
  result: LimitParseResult | null;
  diagnostics: ParserDiagnostics;
}

// ---- Window label patterns ----

const WINDOW_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\b5\s*h(?:ours?|小时)?\b/i, label: '5h' },
  { regex: /\b3\s*h(?:ours?|小时)?\b/i, label: '3h' },
  { regex: /\bdaily\b|\btoday\b/i, label: 'day' },
  { regex: /\bweekly\b|\bthis\s*week\b/i, label: 'week' },
  { regex: /\bmonthly\b|\bthis\s*month\b/i, label: 'month' },
  // Chinese patterns — \b doesn't work with CJK, match directly
  { regex: /每日|每天|今日/, label: 'day' },
  { regex: /每周|本周/, label: 'week' },
  { regex: /每月|本月/, label: 'month' },
];

// ---- Number parsing ----

/**
 * Parse a number string with optional K/M/B suffix or comma separators.
 * Examples: "1.2M" → 1200000, "380K" → 380000, "1,200,000" → 1200000
 */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,，\s]/g, '').trim();
  if (!cleaned) return null;

  // Suffix multipliers
  const suffixMatch = cleaned.match(/^([\d.]+)\s*([KkMmBb])?$/);
  if (!suffixMatch) return null;

  const num = parseFloat(suffixMatch[1]);
  if (isNaN(num)) return null;

  const suffix = (suffixMatch[2] || '').toUpperCase();
  switch (suffix) {
    case 'K': return Math.round(num * 1_000);
    case 'M': return Math.round(num * 1_000_000);
    case 'B': return Math.round(num * 1_000_000_000);
    default: return Math.round(num);
  }
}

// ---- Used/total pair patterns ----

/**
 * Try to extract a used/total number pair from a line.
 * Supports: "1.2M/2M", "1,200,000 / 2,000,000", "1.2M of 2M"
 */
function extractNumberPair(line: string): { used: number; total: number } | null {
  // Pattern: number / number (with optional tokens/messages suffix)
  // Use \b after suffix to prevent "messages" → "m" being treated as million
  const fullMatch = line.match(
    /([\d,.]+(?:\s*[KkMmBb]\b)?)\s*\/\s*([\d,.]+(?:\s*[KkMmBb]\b)?)/,
  );
  if (fullMatch) {
    const used = parseNumber(fullMatch[1]);
    const total = parseNumber(fullMatch[2]);
    if (used !== null && total !== null) return { used, total };
  }

  // Pattern: "X of Y" (English)
  const ofMatch = line.match(
    /([\d,.]+(?:\s*[KkMmBb]\b)?)\s+of\s+([\d,.]+(?:\s*[KkMmBb]\b)?)/i,
  );
  if (ofMatch) {
    const used = parseNumber(ofMatch[1]);
    const total = parseNumber(ofMatch[2]);
    if (used !== null && total !== null) return { used, total };
  }

  return null;
}

// ---- Unit detection ----

function detectUnit(line: string): string {
  if (/%|percent/i.test(line)) return 'percent';
  if (/tokens?|token/i.test(line)) return 'tokens';
  if (/messages?|消息/i.test(line)) return 'messages';
  if (/requests?|请求/i.test(line)) return 'requests';
  return 'tokens'; // default
}

function extractPercentRemaining(line: string): number | null {
  const match = line.match(/(\d+(?:\.\d+)?)\s*%\s*(?:remaining|剩余)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

function snippet(line: string): string {
  return line.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function addCandidate(
  candidates: ParserCandidateLine[],
  lineNo: number,
  line: string,
  reason: string,
): void {
  if (candidates.length >= 12) return;
  const text = snippet(line);
  if (!text) return;
  candidates.push({
    line_no: lineNo,
    snippet: text,
    reason,
  });
}

// ---- Main parser ----

/**
 * Parse visible text from ChatGPT/Codex usage page into limit candidates.
 * Returns null if no usable data found.
 */
export function parseLimitText(text: string): LimitParseResult | null {
  return parseLimitTextWithDiagnostics(text).result;
}

export function parseLimitTextWithDiagnostics(
  text: string,
  traceId?: string,
): LimitParseWithDiagnostics {
  const normalizedText = text || '';
  const lines = normalizedText.split('\n');
  const strategiesTried = ['same_line_window_pair', 'nearby_window_pair', 'section_percent_remaining'];
  const candidateLines: ParserCandidateLine[] = [];
  const diagnosticsBase = {
    trace_id: traceId,
    text_length: normalizedText.length,
    line_count: normalizedText.trim().length === 0 ? 0 : lines.length,
    strategies_tried: strategiesTried,
    candidate_lines: candidateLines,
  };

  if (!normalizedText || normalizedText.trim().length === 0) {
    return {
      result: null,
      diagnostics: {
        ...diagnosticsBase,
        failure_reason: 'empty_text',
      },
    };
  }

  const limits: ParsedLimit[] = [];
  const foundWindows = new Set<string>();

  // Strategy 1: Look for lines containing both a window label AND a number pair
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 200) continue; // skip very long lines (likely not data)

    for (const pattern of WINDOW_PATTERNS) {
      if (pattern.regex.test(line) && !foundWindows.has(pattern.label)) {
        const pair = extractNumberPair(line);
        if (pair) {
          addCandidate(candidateLines, i + 1, line, 'same_line_window_pair_match');
          foundWindows.add(pattern.label);
          limits.push({
            window: pattern.label,
            used: pair.used,
            total: pair.total,
            unit: detectUnit(line),
            confidence: 0.8, // window + numbers on same line = high confidence
          });
        } else {
          addCandidate(candidateLines, i + 1, line, 'window_match_without_number_pair');
        }
      }
    }
  }

  // Strategy 2: Look for number pairs on lines without explicit window labels
  // and try to associate with the nearest window label from adjacent lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 200) continue;

    const pair = extractNumberPair(line);
    if (!pair) continue;
    addCandidate(candidateLines, i + 1, line, 'number_pair_without_confirmed_window');

    // Check if we already captured this line in strategy 1
    const alreadyCaptured = limits.some((l) => l.used === pair.used && l.total === pair.total);
    if (alreadyCaptured) continue;

    // Look for window label in current line, or previous 3 lines
    let windowLabel: string | null = null;
    const searchLines = [
      line,
      ...lines.slice(Math.max(0, i - 3), i).map((l) => l.trim()),
    ];

    for (const searchLine of searchLines) {
      for (const pattern of WINDOW_PATTERNS) {
        if (pattern.regex.test(searchLine) && !foundWindows.has(pattern.label)) {
          windowLabel = pattern.label;
          break;
        }
      }
      if (windowLabel) break;
    }

    if (windowLabel) {
      addCandidate(candidateLines, i + 1, line, 'nearby_window_pair_match');
      foundWindows.add(windowLabel);
      limits.push({
        window: windowLabel,
        used: pair.used,
        total: pair.total,
        unit: detectUnit(line),
        confidence: 0.5, // window from nearby line = medium confidence
      });
    }
  }

  // Strategy 3: ChatGPT/Codex analytics may show a section title followed by
  // "40% remaining" instead of used/total numbers.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 200) continue;

    for (const pattern of WINDOW_PATTERNS) {
      if (!pattern.regex.test(line) || foundWindows.has(pattern.label)) continue;

      const nearbyLines = lines.slice(i + 1, Math.min(lines.length, i + 5));
      for (let offset = 0; offset < nearbyLines.length; offset++) {
        const nearbyLine = nearbyLines[offset].trim();
        const remaining = extractPercentRemaining(nearbyLine);
        if (remaining === null) continue;

        addCandidate(candidateLines, i + 1, line, 'section_window_percent_remaining_match');
        addCandidate(candidateLines, i + offset + 2, nearbyLine, 'percent_remaining_value_match');
        foundWindows.add(pattern.label);
        limits.push({
          window: pattern.label,
          used: 100 - remaining,
          total: 100,
          remaining,
          unit: 'percent',
          confidence: 0.9,
        });
        break;
      }
    }
  }

  if (limits.length === 0) {
    return {
      result: null,
      diagnostics: {
        ...diagnosticsBase,
        failure_reason: candidateLines.length > 0
          ? 'candidate_lines_found_but_no_valid_limit'
          : 'no_limit_candidates',
      },
    };
  }

  return {
    result: {
      limits,
      raw_text_snippet: normalizedText.slice(0, 200),
    },
    diagnostics: diagnosticsBase,
  };
}
