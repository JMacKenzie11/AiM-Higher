// Tiny shared helpers used by service files. Kept dep-free.

/**
 * Trim a form-derived value and return null when empty. Shared across
 * plan/foundation/scorecard action files that all normalize optional
 * text inputs the same way.
 */
export function nullableString(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length === 0 ? null : value;
}

/**
 * Build a `Map` keyed on the result of `key(row)` from an array of rows.
 * Handy for O(1) lookups when stitching join-shaped data client-side.
 */
export function indexBy<T, K extends string | number | symbol>(
  rows: readonly T[],
  key: (row: T) => K
): Map<K, T> {
  const map = new Map<K, T>();
  for (const row of rows) map.set(key(row), row);
  return map;
}

/**
 * Group an array of rows by the result of `key(row)` into a `Map` of arrays.
 * Order within each bucket matches the input order.
 */
export function groupBy<T, K extends string | number | symbol>(
  rows: readonly T[],
  key: (row: T) => K
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const existing = map.get(k);
    if (existing) existing.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/**
 * Compute follow-through rate as a 0–100 percent from raw counts.
 * Follow-Through is a discipline signal — only ON-TIME keeps count in
 * the numerator. Late keeps (still "did the work") and missed both
 * contribute to the denominator only.
 *
 * Returns null when there are no resolved commitments at all.
 * Callers should have already excluded `open` (and parked / deleted)
 * rows.
 */
export function computeRateFromCounts(
  keptOnTime: number,
  keptLate: number,
  missed: number
): number | null {
  const denom = keptOnTime + keptLate + missed;
  if (denom === 0) return null;
  return Math.round((keptOnTime / denom) * 100);
}

/**
 * Per-bucket resolution counts. keptOnTime is the numerator of
 * Follow-Through; keptLate is displayed alongside for the "did the
 * work, just late" signal and included in the denominator.
 */
export type ResolutionCounts = {
  keptOnTime: number;
  keptLate: number;
  missed: number;
  keepRate: number | null;
};

/**
 * Fold a list of commitment status strings into keptOnTime / keptLate
 * / missed counts + rate. `open` (and any unknown status) is excluded.
 * Callers that want only the rate can read `.keepRate`; callers that
 * render "kept 4 · late 1 · missed 2" get the counts for free.
 */
export function summarizeKeepRate(
  statuses: readonly string[]
): ResolutionCounts {
  let keptOnTime = 0;
  let keptLate = 0;
  let missed = 0;
  for (const s of statuses) {
    if (s === "kept_on_time") keptOnTime += 1;
    else if (s === "kept_late") keptLate += 1;
    else if (s === "missed") missed += 1;
  }
  return {
    keptOnTime,
    keptLate,
    missed,
    keepRate: computeRateFromCounts(keptOnTime, keptLate, missed),
  };
}

/**
 * Compute follow-through rate from a list of status strings.
 * Convenience wrapper around summarizeKeepRate.
 */
export function computeFollowThroughRate(
  statuses: readonly string[]
): number | null {
  return summarizeKeepRate(statuses).keepRate;
}

/**
 * Group commitment rows by a caller-chosen key (owner, week, priority,
 * etc.) and return per-bucket counts + rate. `open` rows are excluded
 * — same rule as computeFollowThroughRate above.
 */
export function bucketKeepRates<K, T extends { status: string }>(
  rows: readonly T[],
  keyFn: (row: T) => K
): Map<K, ResolutionCounts> {
  const counts = new Map<
    K,
    { keptOnTime: number; keptLate: number; missed: number }
  >();
  for (const row of rows) {
    if (
      row.status !== "kept_on_time" &&
      row.status !== "kept_late" &&
      row.status !== "missed"
    ) {
      continue;
    }
    const key = keyFn(row);
    const bucket =
      counts.get(key) ?? { keptOnTime: 0, keptLate: 0, missed: 0 };
    if (row.status === "kept_on_time") bucket.keptOnTime += 1;
    else if (row.status === "kept_late") bucket.keptLate += 1;
    else bucket.missed += 1;
    counts.set(key, bucket);
  }
  const result = new Map<K, ResolutionCounts>();
  for (const [key, bucket] of counts) {
    result.set(key, {
      ...bucket,
      keepRate: computeRateFromCounts(
        bucket.keptOnTime,
        bucket.keptLate,
        bucket.missed
      ),
    });
  }
  return result;
}
