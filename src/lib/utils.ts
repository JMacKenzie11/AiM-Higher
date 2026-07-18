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
 * Compute follow-through rate (kept / (kept + missed)) from a list of
 * commitment status strings. Excludes `open` from both numerator and
 * denominator. Returns null when there are no resolved commitments.
 */
export function computeFollowThroughRate(
  statuses: readonly string[]
): number | null {
  let kept = 0;
  let missed = 0;
  for (const s of statuses) {
    if (s === "kept") kept += 1;
    else if (s === "missed") missed += 1;
  }
  return computeRateFromCounts(kept, missed);
}
