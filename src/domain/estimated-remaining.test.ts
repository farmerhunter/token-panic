import { describe, it, expect } from 'vitest';
import { estimateRemaining, formatRemaining } from './estimated-remaining';
import type { BurnRate } from '../shared/types';

function burnRate(value: number, confidence: 'high' | 'medium' | 'low' = 'medium'): BurnRate {
  return { value, unit: 'cost/day', confidence };
}

describe('estimateRemaining', () => {
  it('should return minutes for very fast consumption', () => {
    const result = estimateRemaining(1, burnRate(50)); // ¥1 left, ¥50/day
    expect(result).not.toBeNull();
    expect(result!.unit).toBe('minutes');
  });

  it('should return hours for same-day exhaustion', () => {
    const result = estimateRemaining(10, burnRate(20)); // ¥10 left, ¥20/day = ¥0.83/h → ~12h
    expect(result).not.toBeNull();
    expect(result!.unit).toBe('hours');
    expect(result!.value).toBeCloseTo(12, 0);
  });

  it('should return days for typical usage', () => {
    const result = estimateRemaining(53.68, burnRate(4)); // ¥53.68, ¥4/day → ~13.4 days
    expect(result).not.toBeNull();
    expect(result!.unit).toBe('days');
    expect(result!.value).toBeCloseTo(13.4, 0);
  });

  it('should cap at 30 days for very slow consumption', () => {
    const result = estimateRemaining(1000, burnRate(1)); // ¥1000, ¥1/day → ~1000 days
    expect(result).not.toBeNull();
    expect(result!.unit).toBe('days');
    expect(result!.value).toBe(30);
  });

  it('should return null for zero burn rate', () => {
    expect(estimateRemaining(50, burnRate(0))).toBeNull();
  });

  it('should return null for zero balance', () => {
    expect(estimateRemaining(0, burnRate(5))).toBeNull();
  });

  it('should propagate confidence from burn rate', () => {
    const result = estimateRemaining(50, burnRate(5, 'high'));
    expect(result!.confidence).toBe('high');
  });
});

describe('formatRemaining', () => {
  it('should return null for null estimated', () => {
    expect(formatRemaining(null)).toBeNull();
  });

  it('should return null for 近期无消耗 note', () => {
    expect(formatRemaining(null, '近期无消耗')).toBeNull();
  });

  it('should format minutes', () => {
    expect(formatRemaining({ value: 30, unit: 'minutes', confidence: 'low' })).toBe('< 1 小时');
  });

  it('should format hours', () => {
    expect(formatRemaining({ value: 5.5, unit: 'hours', confidence: 'medium' })).toBe('约 5.5 小时');
  });

  it('should format days', () => {
    expect(formatRemaining({ value: 13.4, unit: 'days', confidence: 'high' })).toBe('约 13.4 天');
  });

  it('should cap display at 30 days', () => {
    expect(formatRemaining({ value: 30, unit: 'days', confidence: 'medium' })).toBe('> 30 天');
  });
});
