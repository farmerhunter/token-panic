import { describe, it, expect } from 'vitest';
import {
  clusterPoints,
  detectRecharge,
  selectWindow,
  downsamplePoints,
  processHistory,
} from './history';
import type { HistoryEntry, ClusteredPoint } from './history';

// ---- Helpers ----

function entry(captured_at: string, remaining_amount: number): HistoryEntry {
  return { captured_at, remaining_amount, currency: 'CNY' };
}

function pt(captured_at: string, remaining_amount: number): ClusteredPoint {
  return { captured_at, remaining_amount };
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

// ---- clusterPoints ----

describe('clusterPoints', () => {
  it('should return empty for no entries', () => {
    expect(clusterPoints([])).toEqual([]);
  });

  it('should return single point unchanged', () => {
    const result = clusterPoints([entry('2026-06-01T10:00:00Z', 50)]);
    expect(result).toHaveLength(1);
    expect(result[0].remaining_amount).toBe(50);
  });

  it('should merge points within 5 minutes into one cluster', () => {
    const result = clusterPoints([
      entry('2026-06-01T10:00:00Z', 50),
      entry('2026-06-01T10:03:00Z', 49.5), // 3 min gap → same cluster
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].remaining_amount).toBe(49.5); // latest
  });

  it('should keep points with gap > 5 min as separate clusters', () => {
    const result = clusterPoints([
      entry('2026-06-01T10:00:00Z', 50),
      entry('2026-06-01T10:10:00Z', 49), // 10 min gap → new cluster
    ]);
    expect(result).toHaveLength(2);
  });

  it('should cluster grouped rapid fires then a gap', () => {
    // Scenario C: cluster of manual refreshes, then gap, then another point
    const result = clusterPoints([
      entry('2026-06-01T10:00:00Z', 53.68),
      entry('2026-06-01T10:01:00Z', 53.67), // cluster 1
      entry('2026-06-01T10:30:00Z', 53.50), // cluster 2 (gap > 5min)
      entry('2026-06-01T10:31:00Z', 53.49), // cluster 2
      entry('2026-06-04T14:00:00Z', 48.00), // cluster 3 (3 day gap)
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].remaining_amount).toBe(53.67); // last of cluster 1
    expect(result[1].remaining_amount).toBe(53.49); // last of cluster 2
    expect(result[2].remaining_amount).toBe(48.00); // cluster 3
  });

  it('should handle non-sorted input', () => {
    const result = clusterPoints([
      entry('2026-06-01T10:10:00Z', 49),
      entry('2026-06-01T10:00:00Z', 50),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].captured_at).toBe('2026-06-01T10:00:00Z');
  });
});

// ---- detectRecharge ----

describe('detectRecharge', () => {
  it('should return empty for normal decreasing balance', () => {
    const points = [
      pt('2026-06-01T10:00:00Z', 50),
      pt('2026-06-02T10:00:00Z', 48),
      pt('2026-06-03T10:00:00Z', 45),
    ];
    expect(detectRecharge(points)).toEqual([]);
  });

  it('should detect a significant jump as recharge', () => {
    const points = [
      pt('2026-06-01T10:00:00Z', 50),
      pt('2026-06-02T10:00:00Z', 8),
      pt('2026-06-03T10:00:00Z', 100), // +92, >10% and >¥1
    ];
    const events = detectRecharge(points);
    expect(events).toHaveLength(1);
    expect(events[0].index).toBe(2);
    expect(events[0].reason).toContain('充值');
  });

  it('should not flag small absolute jumps even if percentage is high', () => {
    // ¥0.50 → ¥0.80 is +60% but only +¥0.30, below ¥1 threshold
    const points = [
      pt('2026-06-01T10:00:00Z', 0.50),
      pt('2026-06-02T10:00:00Z', 0.80),
    ];
    expect(detectRecharge(points)).toEqual([]);
  });

  it('should not flag small percentage jumps even if absolute is large', () => {
    // ¥100 → ¥105 is +5%, below 10% threshold but >¥1
    const points = [
      pt('2026-06-01T10:00:00Z', 100),
      pt('2026-06-02T10:00:00Z', 105), // 5% increase
    ];
    expect(detectRecharge(points)).toEqual([]);
  });

  it('should detect multiple recharges', () => {
    const points = [
      pt('2026-06-01T10:00:00Z', 50),
      pt('2026-06-02T10:00:00Z', 10),
      pt('2026-06-03T10:00:00Z', 100), // recharge 1
      pt('2026-06-04T10:00:00Z', 80),
      pt('2026-06-05T10:00:00Z', 10),
      pt('2026-06-06T10:00:00Z', 200), // recharge 2
    ];
    const events = detectRecharge(points);
    expect(events).toHaveLength(2);
    expect(events[0].index).toBe(2);
    expect(events[1].index).toBe(5);
  });
});

// ---- selectWindow ----

describe('selectWindow', () => {
  it('should return all points when no recharge', () => {
    const points = [
      pt('2026-06-01T10:00:00Z', 50),
      pt('2026-06-02T10:00:00Z', 48),
    ];
    expect(selectWindow(points)).toEqual(points);
  });

  it('should return only points after last recharge', () => {
    const points = [
      pt('2026-06-01T10:00:00Z', 50),  // pre-recharge
      pt('2026-06-02T10:00:00Z', 8),   // pre-recharge
      pt('2026-06-03T10:00:00Z', 100), // recharge point (included)
      pt('2026-06-04T10:00:00Z', 95),  // post-recharge
      pt('2026-06-05T10:00:00Z', 90),  // post-recharge
    ];
    const window = selectWindow(points);
    expect(window).toHaveLength(3);
    expect(window[0].remaining_amount).toBe(100);
  });
});

// ---- downsamplePoints ----

describe('downsamplePoints', () => {
  it('should return as-is when below maxPoints', () => {
    const points = [
      pt('2026-06-01T10:00:00Z', 50),
      pt('2026-06-02T10:00:00Z', 48),
    ];
    expect(downsamplePoints(points, 24)).toEqual(points);
  });

  it('should downsample dense recent data to hourly buckets', () => {
    // Create 6 points within the same hour (all < 60 min from now, same hour)
    const now = new Date();
    const points: ClusteredPoint[] = [];
    for (let i = 0; i < 6; i++) {
      const t = new Date(now.getTime() - i * 5 * 60_000); // back 0–25 min
      points.push(pt(t.toISOString(), 50 - i * 0.1));
    }
    const result = downsamplePoints(points, 5);
    // All within at most 2 hour buckets → 1–2 points
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('should respect maxPoints cap', () => {
    const points: ClusteredPoint[] = [];
    for (let i = 0; i < 100; i++) {
      points.push(pt(hoursAgo(i), 50 - i * 0.1));
    }
    const result = downsamplePoints(points, 24);
    expect(result.length).toBeLessThanOrEqual(24);
  });
});

// ---- processHistory (integration) ----

describe('processHistory', () => {
  it('should return empty result for no entries', () => {
    const result = processHistory([]);
    expect(result.points).toEqual([]);
    expect(result.cluster_count).toBe(0);
    expect(result.time_span_hours).toBe(0);
    expect(result.note).toBe('无历史数据');
  });

  it('should process a normal multi-day history', () => {
    const entries = [
      entry('2026-06-01T10:00:00Z', 53.68),
      entry('2026-06-02T10:00:00Z', 51.20),
      entry('2026-06-03T10:00:00Z', 48.90),
      entry('2026-06-04T10:00:00Z', 46.50),
    ];
    const result = processHistory(entries);
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    expect(result.cluster_count).toBe(4);
    expect(result.recharge_events).toEqual([]);
    expect(result.time_span_hours).toBeGreaterThan(0);
  });

  it('should detect zero consumption', () => {
    // All entries have same balance over several days
    const entries = [
      entry('2026-06-01T10:00:00Z', 53.68),
      entry('2026-06-02T10:00:00Z', 53.68),
      entry('2026-06-03T10:00:00Z', 53.68),
      entry('2026-06-07T10:00:00Z', 53.68),
    ];
    const result = processHistory(entries);
    expect(result.note).toBe('近期无消耗');
  });

  it('should filter out pre-recharge data', () => {
    // Before recharge, then recharge, then new consumption
    const entries = [
      entry('2026-06-01T10:00:00Z', 50),
      entry('2026-06-02T10:00:00Z', 48),
      entry('2026-06-03T10:00:00Z', 100), // recharge
      entry('2026-06-04T10:00:00Z', 98),
      entry('2026-06-05T10:00:00Z', 96),
    ];
    const result = processHistory(entries);
    expect(result.recharge_events.length).toBeGreaterThan(0);
    // Window should only include post-recharge data
    expect(result.points[0].remaining_amount).toBe(100);
  });

  it('should cluster rapid refreshes then compute', () => {
    // Scenario C: cluster + gap
    const entries = [
      entry('2026-06-01T10:00:00Z', 53.68),
      entry('2026-06-01T10:01:00Z', 53.67),
      entry('2026-06-01T10:02:00Z', 53.66), // cluster 1 → 1 point (53.66)
      entry('2026-06-04T10:00:00Z', 48.00), // cluster 2 (3 day gap)
    ];
    const result = processHistory(entries);
    expect(result.cluster_count).toBe(2);
    expect(result.points.length).toBe(2);
  });
});
