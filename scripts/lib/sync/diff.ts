import { IGNORED_WHEN_COMPARING, type SyncTable } from "./datasets.ts";

// The diff, as a pure function over two arrays of rows.
//
// Pure on purpose. This decides what gets written into a live customer
// database, so it is the part that has to be testable without a
// network, a fixture instance, or anyone's permission.

export type Row = Record<string, unknown>;

export type TableDiff = {
  table: string;
  inserts: Row[];
  // The full source row, not a patch. A full mirror means the target
  // row becomes the source row; sending a patch would leave a column
  // the source cleared still set on the target.
  updates: Row[];
  // Only the key columns: enough to delete by, and nothing else to
  // get wrong.
  deletes: Row[];
  unchanged: number;
};

export function keyOf(row: Row, primaryKey: readonly string[]): string {
  // JSON of the key values, in declared order. String concatenation
  // would collide: keys ("a", "bc") and ("ab", "c") are different rows
  // that would share a joined key.
  return JSON.stringify(primaryKey.map((k) => row[k] ?? null));
}

// Columns that participate in "has this row changed".
export function comparableColumns(
  row: Row,
  spec: SyncTable
): string[] {
  const excluded = new Set([
    ...(spec.excludeColumns ?? []),
    ...IGNORED_WHEN_COMPARING,
  ]);
  return Object.keys(row)
    .filter((c) => !excluded.has(c))
    .sort();
}

function normalize(value: unknown): string {
  // Compared as JSON so jsonb columns (classroom_trainings.body_json)
  // compare by content rather than by reference. Key order is whatever
  // the driver produced on each side, so objects are re-serialised
  // with sorted keys.
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function rowsDiffer(a: Row, b: Row, spec: SyncTable): boolean {
  const columns = comparableColumns(a, spec);
  for (const c of columns) {
    if (normalize(a[c]) !== normalize(b[c])) return true;
  }
  return false;
}

// Strips columns the dataset excludes, so they are never written.
export function project(row: Row, spec: SyncTable): Row {
  if (!spec.excludeColumns || spec.excludeColumns.length === 0) return row;
  const drop = new Set(spec.excludeColumns);
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!drop.has(k)) out[k] = v;
  return out;
}

export function diffTable(opts: {
  spec: SyncTable;
  source: readonly Row[];
  target: readonly Row[];
}): TableDiff {
  const { spec, source, target } = opts;
  const targetByKey = new Map<string, Row>();
  for (const row of target) targetByKey.set(keyOf(row, spec.primaryKey), row);

  const inserts: Row[] = [];
  const updates: Row[] = [];
  let unchanged = 0;
  const seen = new Set<string>();

  for (const row of source) {
    const key = keyOf(row, spec.primaryKey);
    seen.add(key);
    const existing = targetByKey.get(key);
    if (!existing) {
      inserts.push(project(row, spec));
      continue;
    }
    // A target row whose content differs is overwritten. That is the
    // ownership rule made concrete: an edit made on the target is not
    // a conflict to resolve, it is drift to correct.
    if (rowsDiffer(row, existing, spec)) updates.push(project(row, spec));
    else unchanged += 1;
  }

  // Anything the source no longer has. Full mirror means the target
  // does not get to keep rows the primary deleted.
  const deletes: Row[] = [];
  for (const row of target) {
    const key = keyOf(row, spec.primaryKey);
    if (seen.has(key)) continue;
    const keyOnly: Row = {};
    for (const k of spec.primaryKey) keyOnly[k] = row[k];
    deletes.push(keyOnly);
  }

  return { table: spec.table, inserts, updates, deletes, unchanged };
}

export function isNoOp(diff: TableDiff): boolean {
  return (
    diff.inserts.length === 0 &&
    diff.updates.length === 0 &&
    diff.deletes.length === 0
  );
}

// Write order. Inserts and updates follow the declared dependency
// order so a child never lands before its parent; deletes run in
// reverse so a parent is never removed while a child still points at
// it. Returned as data rather than performed here, so a dry run and a
// real run plan identically and only differ in whether anything is
// executed.
export type WritePlan = {
  upserts: TableDiff[];
  deletes: TableDiff[];
};

export function planWrites(diffs: readonly TableDiff[]): WritePlan {
  return {
    upserts: diffs.filter((d) => d.inserts.length > 0 || d.updates.length > 0),
    deletes: [...diffs].reverse().filter((d) => d.deletes.length > 0),
  };
}

export function summarizeTable(diff: TableDiff): string {
  if (isNoOp(diff)) return `${diff.table}: in sync (${diff.unchanged} rows)`;
  const parts: string[] = [];
  if (diff.inserts.length) parts.push(`+${diff.inserts.length}`);
  if (diff.updates.length) parts.push(`~${diff.updates.length}`);
  if (diff.deletes.length) parts.push(`-${diff.deletes.length}`);
  return `${diff.table}: ${parts.join(" ")} (${diff.unchanged} unchanged)`;
}
