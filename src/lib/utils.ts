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
 * Returns null when there are no resolved commitments (kept+missed=0).
 * Callers should have already excluded `open` rows.
 */
export function computeRateFromCounts(
  kept: number,
  missed: number
): number | null {
  const denom = kept + missed;
  if (denom === 0) return null;
  return Math.round((kept / denom) * 100);
}

/**
 * Fold a list of commitment status strings into {kept, missed, keepRate}.
 * `open` rows are excluded. Callers that need only the rate should use
 * computeFollowThroughRate below; callers that also need the raw counts
 * (e.g. to render "kept 4 / missed 2") should use this.
 */
export function summarizeKeepRate(statuses: readonly string[]): {
  kept: number;
  missed: number;
  keepRate: number | null;
} {
  let kept = 0;
  let missed = 0;
  for (const s of statuses) {
    if (s === "kept") kept += 1;
    else if (s === "missed") missed += 1;
  }
  return { kept, missed, keepRate: computeRateFromCounts(kept, missed) };
}

/**
 * Compute follow-through rate (kept / (kept + missed)) from a list of
 * commitment status strings. Excludes `open` from both numerator and
 * denominator. Returns null when there are no resolved commitments.
 */
export function computeFollowThroughRate(
  statuses: readonly string[]
): number | null {
  return summarizeKeepRate(statuses).keepRate;
}

/**
 * Group commitment rows by a caller-chosen key (owner, week, priority,
 * etc.) and return a per-bucket {kept, missed, keepRate}. Open rows
 * are excluded — same rule as computeFollowThroughRate above. Callers
 * that need only the rate should read `.keepRate`; callers that need
 * to render kept/missed counts get them for free without a second pass.
 */
export function bucketKeepRates<K, T extends { status: string }>(
  rows: readonly T[],
  keyFn: (row: T) => K
): Map<K, { kept: number; missed: number; keepRate: number | null }> {
  const counts = new Map<K, { kept: number; missed: number }>();
  for (const row of rows) {
    if (row.status !== "kept" && row.status !== "missed") continue;
    const key = keyFn(row);
    const bucket = counts.get(key) ?? { kept: 0, missed: 0 };
    if (row.status === "kept") bucket.kept += 1;
    else bucket.missed += 1;
    counts.set(key, bucket);
  }
  const result = new Map<
    K,
    { kept: number; missed: number; keepRate: number | null }
  >();
  for (const [key, bucket] of counts) {
    result.set(key, {
      ...bucket,
      keepRate: computeRateFromCounts(bucket.kept, bucket.missed),
    });
  }
  return result;
}
