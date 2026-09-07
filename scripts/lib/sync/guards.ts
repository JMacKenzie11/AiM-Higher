import type { Row } from "./diff.ts";
import type { SyncDataset, SyncTable } from "./datasets.ts";

// The two things a content sync must refuse to do.
//
// Both are checked against the SOURCE before anything is written, and
// both throw rather than warn. A sync that reports a problem and
// proceeds has already done the damage by the time anyone reads the
// output.

export class SyncRefused extends Error {}

// ---- 1. Never sync a company-scoped table ----------------------
//
// A dataset is platform-wide content authored on the primary. A table
// with a company_id is one tenant's data, and copying it to another
// instance is the single worst thing this tool could do — it would
// not fail, it would quietly place one customer's rows in another
// customer's database.
//
// Checked against the real column list rather than the declared
// dataset, because the dataset is a claim and the schema is the fact.
// A column added later by a migration would otherwise slip through:
// the dataset file would look unchanged and correct.
export function assertNotCompanyScoped(
  dataset: SyncDataset,
  columnsByTable: Readonly<Record<string, readonly string[]>>
): void {
  const offenders: string[] = [];
  for (const spec of dataset.tables) {
    const columns = columnsByTable[spec.table];
    if (!columns) continue;
    if (columns.includes("company_id")) offenders.push(spec.table);
  }
  if (offenders.length > 0) {
    throw new SyncRefused(
      `dataset "${dataset.name}" includes company-scoped ${
        offenders.length === 1 ? "table" : "tables"
      }: ${offenders.join(", ")}. A table with a company_id holds one ` +
        `tenant's data and must never be mirrored to another instance. ` +
        `Remove it from the dataset in scripts/lib/sync/datasets.ts, or ` +
        `if the column is new, decide whether the table is still ` +
        `platform-wide content at all.`
    );
  }
}

// ---- 2. Never sync a row that points at storage ----------------
//
// Storage is per project. A row carrying a storage path or a storage
// URL describes a file that exists on the SOURCE instance, and copying
// the row to a target produces a reference to a file that is not
// there.
//
// Both failure shapes are bad and only one is loud. A private-bucket
// path (classroom_attachments.storage_path) 404s on download, which
// someone eventually reports. A public-bucket URL embedded in
// classroom_trainings.body_json keeps WORKING, because it points at
// the primary's public bucket — so a client instance silently renders
// images served from another instance's storage, and nothing ever
// looks wrong.
//
// As of 2026-09-07 production has zero rows of either kind, so this
// guard has never fired. It exists because the day it fires is the
// day someone adds an image to a lesson without knowing that sync
// exists.
const STORAGE_URL = /https?:\/\/[a-z0-9-]+\.supabase\.co\/storage\//i;
const STORAGE_PATH_COLUMNS = ["storage_path", "file_path", "object_path"];

export type StorageHit = { table: string; column: string; sample: string };

export function findStorageReferences(
  spec: SyncTable,
  rows: readonly Row[]
): StorageHit[] {
  const hits: StorageHit[] = [];
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (STORAGE_PATH_COLUMNS.includes(column) && value) {
        hits.push({ table: spec.table, column, sample: String(value).slice(0, 80) });
        continue;
      }
      // jsonb bodies are searched as text: an <img src> lives
      // somewhere inside a TipTap document and its exact shape is not
      // this module's business.
      if (value === null || value === undefined) continue;
      const text = typeof value === "string" ? value : JSON.stringify(value);
      const found = text.match(STORAGE_URL);
      if (found) {
        hits.push({ table: spec.table, column, sample: found[0] });
      }
    }
  }
  return hits;
}

export function assertNoStorageReferences(hits: readonly StorageHit[]): void {
  if (hits.length === 0) return;
  const shown = hits.slice(0, 5);
  throw new SyncRefused(
    `${hits.length} row value${hits.length === 1 ? "" : "s"} reference ` +
      `Supabase Storage, which is per project:\n` +
      shown.map((h) => `    ${h.table}.${h.column}  ${h.sample}`).join("\n") +
      `\n\n  Copying these produces references to files that exist only on ` +
      `the primary. A private path 404s on download; a public URL keeps ` +
      `working while serving another instance's storage, which is worse ` +
      `because nothing looks broken.\n\n  Syncing storage objects alongside ` +
      `rows is a design decision, not a bug fix. Until it is made, either ` +
      `remove the storage reference from the source content or exclude the ` +
      `column from the dataset.`
  );
}
