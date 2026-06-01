import { describe, it, expect } from 'vitest';
import { linearRegression, calculateBurnRate } from './burn-rate';
import { processHistory } from './history';
import type { HistoryEntry } from './history';

function entry(captured_at: string, remaining_amount: number): HistoryEntry {
  return { captured_at, remaining_amount, currency: 'CNY' };
}

// ---- linearRegression ----

describe('linearRegression', () => {
  it('should return null for fewer than 2 points', () => {
    expect(linearRegression([])).toBeNull();
    expect(linearRegression([{ captured_at: '2026-06-01T10:00:00Z', remaining_amount: 50 }])).toBeNull();
  });

  it('should compute perfect linear regression', () => {
    const points = [
      { captured_at: '2026-06-01T00:00:00Z', remaining_amount: 50 },
      { captured_at: '2026-06-02T00:00:00Z', remaining_amount: 48 },
      { captured_at: '2026-06-03T00:00:00Z', remaining_amount: 46 },
    ];
    const result = linearRegression(points);
    expect(result).not.toBeNull();
    expect(result!.slope).toBeCloseTo(-2 / 24, 4); // -¥2/day = -0.0833/hour
    expect(result!.r_squared).toBeCloseTo(1.0, 5);
  });

  it('should compute regression on noisy data with lower R²', () => {
    const points = [
      { captured_at: '2026-06-01T00:00:00Z', remaining_amount: 50 },
      { captured_at: '2026-06-02T00:00:00Z', remaining_amount: 48 },
      { captured_at: '2026-06-03T00:00:00Z', remaining_amount: 49 }, // went up!
      { captured_at: '2026-06-04T00:00:00Z', remaining_amount: 44 },
    ];
    const result = linearRegression(points);
    expect(result).not.toBeNull();
    expect(result!.r_squared).toBeLessThan(1.0);
  });
});

// ---- calculateBurnRate ----

describe('calculateBurnRate', () => {
  it('should return null for insufficient data', () => {
    const result = processHistory([
      entry('2026-06-01T10:00:00Z', 50),
    ]);
    expect(calculateBurnRate(result)).toBeNull();
  });

  it('should return low confidence for 2 clusters spanning minutes', () => {
    const result = processHistory([
      entry('2026-06-01T10:00:00Z', 50),
      entry('2026-06-01T10:10:00Z', 49.8), // 10 min later
    ]);
    const burnRate = calculateBurnRate(result);
    expect(burnRate).not.toBeNull();
    expect(burnRate!.confidence).toBe('low');
    expect(burnRate!.unit).toBe('cost/day');
  });

  it('should return medium confidence for 3+ clusters spanning hours', () => {
    const result = processHistory([
      entry('2026-06-01T08:00:00Z', 50),
      entry('2026-06-01T12:00:00Z', 48),
      entry('2026-06-01T16:00:00Z', 46),
    ]);
    const burnRate = calculateBurnRate(result);
    expect(burnRate).not.toBeNull();
    expect(burnRate!.confidence).toBe('medium');
    expect(burnRate!.value).toBeGreaterThan(0);
  });

  it('should return high confidence for 5+ clusters spanning 24h+ with clean data', () => {
    const entries = [
      entry('2026-06-01T08:00:00Z', 50),
      entry('2026-06-01T14:00:00Z', 49),
      entry('2026-06-01T20:00:00Z', 48),
      entry('2026-06-02T02:00:00Z', 47),
      entry('2026-06-02T08:00:00Z', 46),
    ];
    const result = processHistory(entries);
    const burnRate = calculateBurnRate(result);
    expect(burnRate).not.toBeNull();
    expect(burnRate!.confidence).toBe('high');
    expect(burnRate!.value).toBeCloseTo(4, 0); // ~¥4/day
  });

  it('should return null for zero consumption', () => {
    const entries = [
      entry('2026-06-01T10:00:00Z', 50),
      entry('2026-06-02T10:00:00Z', 50),
      entry('2026-06-03T10:00:00Z', 50),
    ];
    const result = processHistory(entries);
    expect(calculateBurnRate(result)).toBeNull();
  });

  it('should exclude pre-recharge data and compute correctly', () => {
    const entries = [
      entry('2026-06-01T10:00:00Z', 10),
      entry('2026-06-02T10:00:00Z', 8),   // pre-recharge
      entry('2026-06-03T10:00:00Z', 100),  // recharge!
      entry('2026-06-04T10:00:00Z', 97),
      entry('2026-06-05T10:00:00Z', 94),
      entry('2026-06-06T10:00:00Z', 91),
      entry('2026-06-07T10:00:00Z', 88),
    ];
    const result = processHistory(entries);
    const burnRate = calculateBurnRate(result);
    expect(burnRate).not.toBeNull();
    // Post-recharge: ~¥3/day (100 → 88 over 4 days)
    expect(burnRate!.value).toBeCloseTo(3, 0);
  });

  it('should return null when R² is too low (chaotic data within recharge threshold)', () => {
    // All adjacent changes within ±10% threshold to avoid triggering recharge detection,
    // but overall pattern is chaotic enough to produce R² < 0.3
    const entries = [
      entry('2026-06-01T10:00:00Z', 50),
      entry('2026-06-02T10:00:00Z', 54), // +8%, no recharge
      entry('2026-06-03T10:00:00Z', 49), // -9%
      entry('2026-06-04T10:00:00Z', 53), // +8%
      entry('2026-06-05T10:00:00Z', 48), // -9%
    ];
    const result = processHistory(entries);
    // R² should be low for this oscillating pattern
    const burnRate = calculateBurnRate(result);
    expect(burnRate).toBeNull();
  });
});
