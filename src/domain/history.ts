// ============================================================
// History processing pipeline for burn rate calculation.
//
// Pipeline: raw entries → cluster → detect recharge → downsample → regression window
// See design_decision.md DD-005 through DD-007 for rationale.
// ============================================================

export interface HistoryEntry {
  captured_at: string; // ISO 8601
  remaining_amount: number;
  currency: string;
}

export interface ClusteredPoint {
  captured_at: string;
  remaining_amount: number;
}

export interface RechargeEvent {
  index: number;
  captured_at: string;
  reason: string;
}

export interface ProcessingResult {
  points: ClusteredPoint[];
  cluster_count: number;
  recharge_events: RechargeEvent[];
  time_span_hours: number;
  note?: string;
}

// ---- Constants ----

const CLUSTER_THRESHOLD_MIN = 5; // DD-005
const RECHARGE_PERCENT = 10; // DD-006
const RECHARGE_ABS_MIN = 1.0; // DD-006
const MAX_POINTS_FOR_REGRESSION = 24; // DD-007
const ZERO_CONSUMPTION_THRESHOLD = 0.01; // CNY/hour — below this, treat as zero

// ---- Clustering (DD-005) ----

/**
 * Merge adjacent entries within `thresholdMin` minutes into clusters.
 * Each cluster keeps only the latest (lowest balance) entry.
 * Returns points sorted by time ascending.
 */
export function clusterPoints(
  entries: HistoryEntry[],
  thresholdMin: number = CLUSTER_THRESHOLD_MIN,
): ClusteredPoint[] {
  if (entries.length === 0) return [];

  // Sort by time
  const sorted = [...entries].sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
  );

  const clusters: HistoryEntry[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const prevEntry = sorted[i - 1];
    const currEntry = sorted[i];
    const gapMin =
      (new Date(currEntry.captured_at).getTime() -
        new Date(prevEntry.captured_at).getTime()) /
      60_000;

    if (gapMin < thresholdMin) {
      // Same cluster: add to current group
      clusters[clusters.length - 1].push(currEntry);
    } else {
      // New cluster
      clusters.push([currEntry]);
    }
  }

  // Each cluster → keep the latest entry (lowest remaining_amount as tiebreaker)
  return clusters.map((cluster) => {
    // Pick the last entry in the cluster (most recent capture time)
    const representative = cluster[cluster.length - 1];
    return {
      captured_at: representative.captured_at,
      remaining_amount: representative.remaining_amount,
    };
  });
}

// ---- Recharge Detection (DD-006) ----

/**
 * Detect recharge events where balance jumps upward significantly.
 * Returns an array of RechargeEvents with their positions.
 * Points after the last recharge event form the valid regression window.
 */
export function detectRecharge(
  points: ClusteredPoint[],
  thresholdPercent: number = RECHARGE_PERCENT,
  thresholdAbs: number = RECHARGE_ABS_MIN,
): RechargeEvent[] {
  const events: RechargeEvent[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].remaining_amount;
    const curr = points[i].remaining_amount;
    const diff = curr - prev;

    if (
      diff > thresholdAbs &&
      curr > prev * (1 + thresholdPercent / 100)
    ) {
      events.push({
        index: i,
        captured_at: points[i].captured_at,
        reason: `余额从 ¥${prev.toFixed(2)} 上升至 ¥${curr.toFixed(2)}，疑似充值`,
      });
    }
  }

  return events;
}

/**
 * Return the valid window of points for burn rate regression.
 * Uses only points after the last recharge event.
 */
export function selectWindow(points: ClusteredPoint[]): ClusteredPoint[] {
  const recharges = detectRecharge(points);
  if (recharges.length === 0) return points;

  const lastRechargeIdx = recharges[recharges.length - 1].index;
  // Include the recharge point itself (first point of new cycle)
  return points.slice(lastRechargeIdx);
}

// ---- Downsampling (DD-007) ----

/**
 * Reduce dense data to a manageable number of representative points.
 * - Last 24h: max 1 point per hour (keep latest per hour)
 * - 24h–7d: max 1 point per day (keep latest per day)
 * - 7d+: keep as-is (already sparse)
 */
export function downsamplePoints(
  points: ClusteredPoint[],
  maxPoints: number = MAX_POINTS_FOR_REGRESSION,
): ClusteredPoint[] {
  if (points.length <= maxPoints) return points;

  const now = new Date();
  const sorted = [...points].sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
  );

  // Partition by age
  const last24h: ClusteredPoint[] = [];
  const last7d: ClusteredPoint[] = [];
  const older: ClusteredPoint[] = [];

  for (const p of sorted) {
    const ageHours =
      (now.getTime() - new Date(p.captured_at).getTime()) / 3_600_000;
    if (ageHours <= 24) {
      last24h.push(p);
    } else if (ageHours <= 24 * 7) {
      last7d.push(p);
    } else {
      older.push(p);
    }
  }

  // Downsample: bucket by hour/day and take latest in each bucket
  const downsampled24h = bucketBy(last24h, (p) => {
    const d = new Date(p.captured_at);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
  });

  const downsampled7d = bucketBy(last7d, (p) => {
    const d = new Date(p.captured_at);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  });

  // Combine
  const result = [...downsampled24h, ...downsampled7d, ...older];

  // If still over maxPoints, keep most recent
  if (result.length > maxPoints) {
    return result.slice(result.length - maxPoints);
  }

  return result;
}

function bucketBy(
  points: ClusteredPoint[],
  keyFn: (p: ClusteredPoint) => string,
): ClusteredPoint[] {
  const buckets = new Map<string, ClusteredPoint>();
  for (const p of points) {
    const key = keyFn(p);
    const existing = buckets.get(key);
    if (
      !existing ||
      new Date(p.captured_at).getTime() > new Date(existing.captured_at).getTime()
    ) {
      buckets.set(key, p);
    }
  }
  // Return sorted by time
  return Array.from(buckets.values()).sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
  );
}

// ---- Full processing pipeline ----

/**
 * Run the full history processing pipeline.
 * Returns the regression-ready window plus metadata.
 */
export function processHistory(entries: HistoryEntry[]): ProcessingResult {
  if (entries.length === 0) {
    return {
      points: [],
      cluster_count: 0,
      recharge_events: [],
      time_span_hours: 0,
      note: '无历史数据',
    };
  }

  const clustered = clusterPoints(entries);
  const recharges = detectRecharge(clustered);
  const window = selectWindow(clustered);
  const downsampled = downsamplePoints(window);

  // cluster_count should reflect the window, not the original dataset
  // Re-cluster the window to get correct cluster count (DD-009 fix)
  const windowClustered = clusterPoints(
    window.map((p) => ({
      captured_at: p.captured_at,
      remaining_amount: p.remaining_amount,
      currency: 'CNY',
    })),
  );

  const timeSpanHours =
    downsampled.length >= 2
      ? (new Date(downsampled[downsampled.length - 1].captured_at).getTime() -
          new Date(downsampled[0].captured_at).getTime()) /
        3_600_000
      : 0;

  // Check for zero consumption
  let note: string | undefined;
  if (
    downsampled.length >= 2 &&
    timeSpanHours > 0 &&
    Math.abs(downsampled[0].remaining_amount - downsampled[downsampled.length - 1].remaining_amount) /
      timeSpanHours <
      ZERO_CONSUMPTION_THRESHOLD
  ) {
    note = '近期无消耗';
  }

  return {
    points: downsampled,
    cluster_count: windowClustered.length,
    recharge_events: recharges,
    time_span_hours: timeSpanHours,
    note,
  };
}
