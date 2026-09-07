// What gets mirrored from the primary instance outward, and why.
//
// A dataset is a named group of tables that the primary instance owns
// outright. Sync is one way: the primary is the author, every other
// instance is a copy, and a row edited on a copy is overwritten on the
// next run. That rule is the whole design and it is not negotiable per
// table — a table that anyone else may legitimately edit does not
// belong in a dataset at all.
//
// TABLES ARE LISTED IN DEPENDENCY ORDER. Inserts and updates run in
// that order so a child never lands before its parent; deletes run in
// reverse for the same reason. The order is declared rather than
// derived because deriving it means reading foreign keys at runtime
// and getting the answer wrong when a cycle appears, and a wrong
// answer here writes rows into a live customer database.

export type SyncTable = {
  table: string;
  // Composite keys are real here: classroom_lesson_tags is keyed by
  // (lesson_id, tag_id) with no surrogate id, so the matcher cannot
  // assume a single "id" column.
  primaryKey: string[];
  // Columns neither read, written, nor compared. For columns that
  // should be COPIED but not counted as a change, see
  // IGNORED_WHEN_COMPARING below.
  excludeColumns?: string[];
};

export type SyncDataset = {
  name: string;
  description: string;
  tables: SyncTable[];
};

// Copied so a target row is a faithful mirror, but never the reason a
// row is considered changed. Without this every run would rewrite
// every row: updated_at differs the moment the source is edited, and
// comparing it would make "changed" mean "touched" rather than
// "different".
export const IGNORED_WHEN_COMPARING: readonly string[] = [
  "created_at",
  "updated_at",
];

// ---- classroom -------------------------------------------------
//
// Six tables, verified against the live production schema on
// 2026-09-07 rather than reconstructed from migrations — migration
// 0145 dropped four columns from classroom_trainings, so the original
// CREATE TABLE in 0120 no longer describes the table.
//
// Every one of them is platform-wide. `company_id` appears in the
// classroom migrations only inside RLS policies, where it reads the
// VIEWER's company to check the classroom feature flag. It is not a
// column on any of these tables, which is what makes the dataset
// legitimate: there is no tenant's data in here to leak.
//
// classroom_attachments is included but is the one to watch. It
// carries storage_path, a pointer into the private
// classroom-attachments bucket, and storage is per project. Syncing a
// row whose file exists only on the primary produces a row that looks
// fine and 404s on download. It is empty on production today, so the
// guard in guards.ts refuses the run if that ever changes rather than
// shipping references to a file that is not there.
export const classroom: SyncDataset = {
  name: "classroom",
  description: "Classroom categories, tags, lessons, trainings and attachments",
  tables: [
    { table: "classroom_categories", primaryKey: ["id"] },
    { table: "classroom_tags", primaryKey: ["id"] },
    { table: "classroom_lessons", primaryKey: ["id"] },
    { table: "classroom_lesson_tags", primaryKey: ["lesson_id", "tag_id"] },
    { table: "classroom_trainings", primaryKey: ["id"] },
    { table: "classroom_attachments", primaryKey: ["id"] },
  ],
};

export const DATASETS: readonly SyncDataset[] = [classroom];

export function datasetByName(name: string): SyncDataset | null {
  return DATASETS.find((d) => d.name === name) ?? null;
}
