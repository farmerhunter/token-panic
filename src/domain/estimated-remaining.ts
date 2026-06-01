// ============================================================
// Estimated remaining time from burn rate and current balance.
// See design_decision.md DD-010.
// ============================================================

import type { BurnRate, EstimatedRemaining } from '../shared/types';

/**
 * Estimate how long the remaining balance will last at the current burn rate.
 * Returns null if burn rate is zero or balance is insufficient.
 */
export function estimateRemaining(
  remainingAmount: number,
  burnRate: BurnRate,
): EstimatedRemaining | null {
  if (burnRate.value <= 0) return null; // zero or negative burn rate
  if (remainingAmount <= 0) return null;

  const costPerHour = burnRate.value / 24; // burnRate.value is cost/day
  if (costPerHour <= 0) return null;

  const remainingHours = remainingAmount / costPerHour;

  // Convert to appropriate unit
  if (remainingHours < 1) {
    return {
      value: roundTo(remainingHours * 60, 0),
      unit: 'minutes',
      confidence: burnRate.confidence,
    };
  }

  if (remainingHours < 24) {
    return {
      value: roundTo(remainingHours, 1),
      unit: 'hours',
      confidence: burnRate.confidence,
    };
  }

  if (remainingHours <= 720) {
    // ≤ 30 days
    return {
      value: roundTo(remainingHours / 24, 1),
      unit: 'days',
      confidence: burnRate.confidence,
    };
  }

  // > 30 days: don't give precise number
  return {
    value: 30,
    unit: 'days',
    confidence: burnRate.confidence,
  };
}

/**
 * Format estimated remaining as a human-readable Chinese string.
 */
export function formatRemaining(
  estimated: EstimatedRemaining | null,
  note?: string,
): string | null {
  if (!estimated) return null;

  // Context notes
  if (note === '近期无消耗') return null;

  switch (estimated.unit) {
    case 'minutes':
      return `< 1 小时`;
    case 'hours':
      return `约 ${estimated.value} 小时`;
    case 'days':
      if (estimated.value >= 30) return '> 30 天';
      return `约 ${estimated.value} 天`;
    default:
      return null;
  }
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
