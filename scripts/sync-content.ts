/**
 * scripts/sync-content.ts
 *
 * Mirrors declared datasets from the primary instance to every other
 * active instance in the registry.
 *
 * Usage:
 *   npm run sync:content -- --dry-run
 *   npm run sync:content
 *   npm run sync:content -- --dataset classroom
 *   npm run sync:content -- --instance promiseone
 *
 * ONE WAY, PRIMARY OUTWARD, FULL MIRROR. The primary instance (env
 * prefix PROD) authors these datasets. Every other instance receives a
 * copy: rows are inserted, changed rows are overwritten, and rows the
 * primary no longer has are deleted. An edit made on a target instance
 * is not a conflict to merge, it is drift, and this tool removes it.
 *
 * That rule is why the dataset registry is small and deliberate. A
 * table anyone else may legitimately edit must not be in a dataset,
 * because this tool will silently discard their work.
 *
 * Primary keys are preserved, including UUIDs, so cross-references
 * between synced tables survive the copy and a lesson on one instance
 * has the same id as the same lesson on another.
 *
 * Config comes from .env.provisioning and nowhere else, the same rule
 * provisioning and the migration runner follow. .env.local's
 * CONTROL_PLANE_* get repointed during local testing and inheriting
 * them here would mirror content into the wrong fleet.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isEntryPoint } from "./lib/entry-point.ts";
import {
  DATASETS,
  datasetByName,
  type SyncDataset,
  type SyncTable,
} from "./lib/sync/datasets.ts";
import {
  diffTable,
  planWrites,
  summarizeTable,
  type Row,
  type TableDiff,
} from "./lib/sync/diff.ts";
import {
  assertNotCompanyScoped,
  assertNoStorageReferences,
  findStorageReferences,
  SyncRefused,
} from "./lib/sync/guards.ts";

try {
  process.loadEnvFile(".env.provisioning");
} catch {
  // Missing values are reported by name below.
}

const PRIMARY_PREFIX = "PROD";
const REQUIRED = [
  "CONTROL_PLANE_SUPABASE_URL",
  "CONTROL_PLANE_SUPABASE_SERVICE_KEY",
];

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

type RegistryRow = {
  subdomain: string;
  display_name?: string;
  env_prefix: string;
  status: string;
};

export type Target = {
  subdomain: string;
  envPrefix: string;
  client: SupabaseClient;
  aliases: string[];
};

export type InstanceOutcome = {
  subdomain: string;
  envPrefix: string;
  ok: boolean;
  diffs: TableDiff[];
  error: string | null;
};

export function parseArgs(argv: string[]): {
  dryRun: boolean;
  dataset: string | null;
  instance: string | null;
} {
  let dryRun = false;
  let dataset: string | null = null;
  let instance: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") {
      dryRun = true;
    } else if (argv[i] === "--dataset") {
      dataset = argv[i + 1] ?? null;
      if (!dataset) fail("--dataset needs a name.");
      i += 1;
    } else if (argv[i] === "--instance") {
      instance = argv[i + 1] ?? null;
      if (!instance) fail("--instance needs a subdomain.");
      i += 1;
    } else {
      fail(
        `Unknown argument ${argv[i]}. ` +
          `Options: --dry-run, --dataset <name>, --instance <subdomain>.`
      );
    }
  }
  return { dryRun, dataset, instance };
}

function clientFor(prefix: string): SupabaseClient {
  const url = process.env[`${prefix}_SUPABASE_URL`];
  const key = process.env[`${prefix}_SUPABASE_SERVICE_KEY`];
  if (!url || !key) {
    throw new Error(
      `${prefix}_SUPABASE_URL / _SERVICE_KEY are not both set in ` +
        `.env.provisioning, so this instance cannot be reached`
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchAll(client: SupabaseClient, table: string): Promise<Row[]> {
  // Paged. A dataset is small today, and "small today" is not a
  // property to build a full-mirror delete on: a missed page would
  // read as "the source no longer has these rows" and delete them
  // from every target.
  const pageSize = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function columnsOf(
  client: SupabaseClient,
  table: string
): Promise<string[]> {
  // One row is enough to learn the shape, and an empty table has no
  // rows to leak, so a table we cannot inspect is one we also cannot
  // sync anything out of.
  const { data, error } = await client.from(table).select("*").limit(1);
  if (error) throw new Error(`inspecting ${table}: ${error.message}`);
  const [row] = (data ?? []) as Row[];
  return row ? Object.keys(row) : [];
}

async function applyDiff(
  client: SupabaseClient,
  spec: SyncTable,
  diff: TableDiff
): Promise<void> {
  if (diff.inserts.length > 0 || diff.updates.length > 0) {
    const rows = [...diff.inserts, ...diff.updates];
    // upsert on the declared key: one round trip, and it does not
    // matter whether the target already had the row.
    const { error } = await client
      .from(spec.table)
      .upsert(rows, { onConflict: spec.primaryKey.join(",") });
    if (error) throw new Error(`writing ${spec.table}: ${error.message}`);
  }
}

async function applyDeletes(
  client: SupabaseClient,
  spec: SyncTable,
  diff: TableDiff
): Promise<void> {
  for (const row of diff.deletes) {
    let query = client.from(spec.table).delete();
    for (const k of spec.primaryKey) {
      query = query.eq(k, row[k] as string);
    }
    const { error } = await query;
    if (error) throw new Error(`deleting from ${spec.table}: ${error.message}`);
  }
}

async function syncInstance(opts: {
  target: Target;
  primary: SupabaseClient;
  datasets: readonly SyncDataset[];
  dryRun: boolean;
  log: (line: string) => void;
}): Promise<InstanceOutcome> {
  const { target, primary, datasets, dryRun, log } = opts;
  const diffs: TableDiff[] = [];

  for (const dataset of datasets) {
    // Guards run against the SOURCE, before anything is written.
    const columnsByTable: Record<string, string[]> = {};
    for (const spec of dataset.tables) {
      columnsByTable[spec.table] = await columnsOf(primary, spec.table);
    }
    assertNotCompanyScoped(dataset, columnsByTable);

    const sourceByTable = new Map<string, Row[]>();
    for (const spec of dataset.tables) {
      const rows = await fetchAll(primary, spec.table);
      sourceByTable.set(spec.table, rows);
      assertNoStorageReferences(findStorageReferences(spec, rows));
    }

    const datasetDiffs: TableDiff[] = [];
    for (const spec of dataset.tables) {
      const source = sourceByTable.get(spec.table) ?? [];
      const targetRows = await fetchAll(target.client, spec.table);
      datasetDiffs.push(diffTable({ spec, source, target: targetRows }));
    }

    for (const d of datasetDiffs) {
      log(`  ${target.subdomain}: ${dataset.name}/${summarizeTable(d)}`);
    }
    diffs.push(...datasetDiffs);

    if (dryRun) continue;

    const plan = planWrites(datasetDiffs);
    const specByTable = new Map(dataset.tables.map((t) => [t.table, t]));
    for (const d of plan.upserts) {
      await applyDiff(target.client, specByTable.get(d.table)!, d);
    }
    for (const d of plan.deletes) {
      await applyDeletes(target.client, specByTable.get(d.table)!, d);
    }
  }

  return {
    subdomain: target.subdomain,
    envPrefix: target.envPrefix,
    ok: true,
    diffs,
    error: null,
  };
}

// Sequential with per-instance isolation, same as the migration runner
// and the cron fan-out: one instance failing must not stop the rest,
// and the loop always finishes so the summary describes the whole
// fleet rather than however far it got.
//
// Exported so isolation and dry-run can be tested without a network.
// They are the two properties that matter most and the two hardest to
// see by reading.
export async function syncFleet(opts: {
  targets: readonly Target[];
  primary: SupabaseClient;
  datasets: readonly SyncDataset[];
  dryRun: boolean;
  log: (line: string) => void;
}): Promise<InstanceOutcome[]> {
  const outcomes: InstanceOutcome[] = [];
  for (const target of opts.targets) {
    try {
      outcomes.push(
        await syncInstance({
          target,
          primary: opts.primary,
          datasets: opts.datasets,
          dryRun: opts.dryRun,
          log: opts.log,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.log(
        `  ${target.subdomain}: ${err instanceof SyncRefused ? "REFUSED" : "FAILED"} — ${message.split("\n")[0]}`
      );
      outcomes.push({
        subdomain: target.subdomain,
        envPrefix: target.envPrefix,
        ok: false,
        diffs: [],
        error: message,
      });
    }
  }
  return outcomes;
}

export function summaryLines(outcomes: readonly InstanceOutcome[]): string[] {
  const width = Math.max(9, ...outcomes.map((o) => o.subdomain.length));
  const lines: string[] = [];
  for (const o of outcomes) {
    const name = o.subdomain.padEnd(width);
    if (!o.ok) {
      lines.push(`    ${name}  FAILED`);
      lines.push(`    ${" ".repeat(width)}  ${(o.error ?? "").split("\n")[0]}`);
      continue;
    }
    const ins = o.diffs.reduce((n, d) => n + d.inserts.length, 0);
    const upd = o.diffs.reduce((n, d) => n + d.updates.length, 0);
    const del = o.diffs.reduce((n, d) => n + d.deletes.length, 0);
    if (ins === 0 && upd === 0 && del === 0) {
      lines.push(`    ${name}  in sync`);
    } else {
      lines.push(
        `    ${name}  ${ins} inserted, ${upd} updated, ${del} deleted`
      );
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const { dryRun, dataset, instance } = parseArgs(process.argv.slice(2));

  const missing = REQUIRED.filter((n) => !process.env[n]?.trim());
  if (missing.length > 0) {
    fail(
      `Missing configuration:\n${missing.map((n) => `    ${n}`).join("\n")}\n\n` +
        `  These live in .env.provisioning. See .env.provisioning.example.`
    );
  }

  const datasets = dataset
    ? [datasetByName(dataset) ?? fail(`No dataset named "${dataset}". Known: ${DATASETS.map((d) => d.name).join(", ")}.`)]
    : DATASETS;

  const control = createClient(
    process.env.CONTROL_PLANE_SUPABASE_URL as string,
    process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await control
    .from("instances")
    .select("subdomain, display_name, env_prefix, status")
    .eq("status", "active")
    .order("subdomain");
  if (error) fail(`Couldn't read the registry: ${error.message}`);

  const rows = (data ?? []) as RegistryRow[];

  // Deduplicate by env_prefix, the same rule the migration runner and
  // the cron fan-out use: two registry rows naming one prefix are one
  // database, and mirroring into it twice would report two instances
  // where there is one.
  const byPrefix = new Map<string, { row: RegistryRow; aliases: string[] }>();
  for (const row of rows) {
    const seen = byPrefix.get(row.env_prefix);
    if (seen) seen.aliases.push(row.subdomain);
    else byPrefix.set(row.env_prefix, { row, aliases: [] });
  }

  const primary = clientFor(PRIMARY_PREFIX);
  const targets: Target[] = [];
  for (const { row, aliases } of byPrefix.values()) {
    // The primary is the source. Mirroring it onto itself is a no-op
    // at best and, with a full-mirror delete, is not worth finding out.
    if (row.env_prefix === PRIMARY_PREFIX) continue;
    if (instance && row.subdomain !== instance) continue;
    targets.push({
      subdomain: row.subdomain,
      envPrefix: row.env_prefix,
      client: clientFor(row.env_prefix),
      aliases,
    });
  }

  if (instance && targets.length === 0) {
    fail(
      `No active instance "${instance}" in the registry, or it is the ` +
        `primary. Active: ${rows.map((r) => r.subdomain).join(", ")}.`
    );
  }

  console.log("");
  console.log(
    `  ${dryRun ? "Planning" : "Syncing"} ${datasets.map((d) => d.name).join(", ")} ` +
      `from ${PRIMARY_PREFIX} to ${targets.length} instance${targets.length === 1 ? "" : "s"}`
  );
  console.log(`  Control plane: ${process.env.CONTROL_PLANE_SUPABASE_URL}`);
  console.log(
    "  One way: the primary is the author. Edits made on a target are " +
      "overwritten by design."
  );
  console.log("");

  if (targets.length === 0) {
    console.log("  No target instances. Nothing to do.\n");
    return;
  }

  const outcomes = await syncFleet({
    targets,
    primary,
    datasets,
    dryRun,
    log: (line) => console.log(line),
  });

  console.log("");
  console.log("  Summary");
  console.log("  ───────");
  for (const line of summaryLines(outcomes)) console.log(line);
  console.log("");

  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length > 0) {
    console.error(
      `  ${failed.length} of ${outcomes.length} instances failed.\n`
    );
    for (const f of failed) console.error(`  ${f.subdomain}: ${f.error}\n`);
    process.exit(1);
  }
  if (dryRun) console.log("  --dry-run: nothing was written.\n");
}

// Runs only when this file IS the process entry point. Importing it
// must never execute it. See scripts/lib/entry-point.ts.
if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
