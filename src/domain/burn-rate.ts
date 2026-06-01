// ============================================================
// Burn rate calculation via simple linear regression.
// See design_decision.md DD-008 and DD-009.
// ============================================================

import type { BurnRate } from '../shared/types';
import type { ClusteredPoint, ProcessingResult } from './history';

// ---- Linear regression ----

interface RegressionResult {
  slope: number; // CNY per hour (negative = consuming)
  intercept: number;
  r_squared: number;
}

/**
 * Simple linear regression (least squares).
 * x = hours since first point, y = remaining_amount.
 * Returns slope (CNY/hour), intercept, and R².
 */
export function linearRegression(points: ClusteredPoint[]): RegressionResult | null {
  if (points.length < 2) return null;

  const baseMs = new Date(points[0].captured_at).getTime();

  // Convert to (hours, amount) pairs
  const data = points.map((p) => ({
    x: (new Date(p.captured_at).getTime() - baseMs) / 3_600_000,
    y: p.remaining_amount,
  }));

  const n = data.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (const d of data) {
    sumX += d.x;
    sumY += d.y;
    sumXY += d.x * d.y;
    sumX2 += d.x * d.x;
    sumY2 += d.y * d.y;
  }

  const meanX = sumX / n;
  const meanY = sumY / n;

  // Slope: Σ((x - x̄)(y - ȳ)) / Σ((x - x̄)²)
  const numerator = sumXY - n * meanX * meanY;
  const denominator = sumX2 - n * meanX * meanX;

  if (Math.abs(denominator) < 1e-10) {
    // All x values are the same (shouldn't happen after clustering)
    return null;
  }

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;

  // R² = 1 - (SS_res / SS_tot)
  let ssRes = 0;
  let ssTot = 0;
  for (const d of data) {
    const yPred = slope * d.x + intercept;
    ssRes += (d.y - yPred) ** 2;
    ssTot += (d.y - meanY) ** 2;
  }

  const rSquared = ssTot > 1e-10 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r_squared: Math.max(0, Math.min(1, rSquared)) };
}

// ---- Confidence model (DD-009) ----

type Confidence = 'high' | 'medium' | 'low';

function calculateConfidence(
  clusterCount: number,
  timeSpanHours: number,
  rSquared: number,
): Confidence | null {
  if (clusterCount < 2) return null;

  // R² too low → data too noisy
  if (rSquared < 0.3) return null;

  // high: ≥5 clusters, ≥24h span, R² ≥ 0.8
  if (clusterCount >= 5 && timeSpanHours >= 24 && rSquared >= 0.8) {
    return 'high';
  }

  // medium: ≥3 clusters, ≥6h span
  if (clusterCount >= 3 && timeSpanHours >= 6) {
    return 'medium';
  }

  // low: ≥2 clusters, ≥5min span
  return 'low';
}

// ---- Main calculator ----

/**
 * Calculate burn rate from processed history.
 * Returns null if insufficient data or zero consumption.
 */
export function calculateBurnRate(result: ProcessingResult): BurnRate | null {
  // Check for zero consumption note
  if (result.note === '近期无消耗') return null;

  if (result.points.length < 2) return null;

  const regression = linearRegression(result.points);
  if (!regression) return null;

  // If slope is positive (balance increasing) and we somehow got here
  // (recharge detection missed it), treat as zero consumption
  if (regression.slope >= 0) return null;

  const confidence = calculateConfidence(
    result.cluster_count,
    result.time_span_hours,
    regression.r_squared,
  );

  if (!confidence) return null;

  // Convert slope (CNY/hour) to cost/day for display
  const costPerDay = Math.abs(regression.slope) * 24;

  return {
    value: roundTo(costPerDay, 2),
    unit: 'cost/day',
    confidence,
  };
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
