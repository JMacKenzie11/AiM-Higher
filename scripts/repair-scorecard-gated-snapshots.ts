/**
 * scripts/repair-scorecard-gated-snapshots.ts
 *
 * Deletes the feature-gated discipline snapshots written while the
 * weekly scorecard cron could not read entitlements.
 *
 * Usage:
 *   npm run repair:scorecard-snapshots -- --dry-run     # the plan, touching nothing
 *   npm run repair:scorecard-snapshots                  # apply, with a typed confirmation
 *   npm run repair:scorecard-snapshots -- --yes         # apply without the prompt
 *   npm run repair:scorecard-snapshots -- --instance promiseone
 *   npm run repair:scorecard-snapshots -- --through 2026-09-06
 *
 * WHAT WENT WRONG. computeCompanyScorecard resolved feature flags
 * through the request-scoped getCompanyFeatures(), which reads with the
 * cookie-scoped Supabase client. The cron has no session, so that
 * client reached PostgREST as `anon`; every policy on company_features
 * is `to authenticated`, so the read came back EMPTY rather than
 * failing. Both flags resolved false on every run from 2026-08-13
 * onward and all four feature-gated disciplines were recorded as
 * { score: null, breakdown: { notEnabled: true } }. Fixed in #59.
 *
 * WHY DELETION IS THE WHOLE REPAIR. Not one gated discipline has ever
 * been scored, on any instance, on any date, so nothing that was once
 * right is being destroyed. Rebuilding the rows faithfully is not
 * available: every scorer anchors its window to now() with no as-of
 * parameter, and company_features records no history at all (disabling
 * a feature hard-deletes the row), so for any past date there is no way
 * to know whether a discipline should have scored or been marked off.
 * Deleting leaves a gap the sparkline already renders as a gap, and
 * correct history accumulates from the next Sunday run.
 *
 * Rows for companies that genuinely had the module switched off are
 * deleted too. They carry no information — "off" is re-derived
 * correctly on the next run — and keeping them would mean keeping
 * exactly the rows that cannot be told apart from the wrong ones.
 *
 * THE DATE BOUND IS LOAD-BEARING. Only snapshots on or before
 * LAST_AFFECTED_SNAPSHOT_DATE are touched. After the fix ships, a
 * company that genuinely lacks a module produces a legitimate
 * notEnabled row that is byte-identical to a broken one, so an
 * unbounded predicate would eat correct data the moment this script
 * was run twice. Override with --through only to move the bound
 * EARLIER.
 *
 * Config comes from .env.provisioning and nowhere else, the same rule
 * migrate:instances follows.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isEntryPoint } from "./lib/entry-point.ts";

// The four disciplines gated on a company feature. Hardcoded rather
// than imported from src/lib/maturity/disciplines.ts on purpose: this
// script repairs history written by a PAST version of that config, and
// it must keep naming those four even after a future release adds or
// renames one.
const GATED_DISCIPLINES = [
  "measures",
  "meetings",
  "solution_seeking",
  "positive_framing",
] as const;

// The last snapshot the broken code could have written. The cron runs
// Sundays 07:00 UTC and stamps snapshot_date in each company's
// timezone, so a week lands as a Saturday/Sunday pair; 2026-09-06 is
// the Sunday half of the last run before the fix. Anything later was
// written by fixed code and is real data.
const LAST_AFFECTED_SNAPSHOT_DATE = "2026-09-06";

const TABLE = "company_discipline_snapshots";

try {
  process.loadEnvFile(".env.provisioning");
} catch {
  // Missing values are reported by name below.
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

export type RegistryRow = {
  subdomain: string;
  display_name: string;
  env_prefix: string;
  status: string;
};

export type InstanceOutcome = {
  subdomain: string;
  state: "ok" | "blocked" | "failed";
  matched: number;
  deleted: number;
  detail: string;
};

export function parseArgs(argv: string[]): {
  dryRun: boolean;
  yes: boolean;
  instance: string | null;
  through: string;
} {
  let dryRun = false;
  let yes = false;
  let instance: string | null = null;
  let through = LAST_AFFECTED_SNAPSHOT_DATE;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") {
      dryRun = true;
    } else if (argv[i] === "--yes") {
      yes = true;
    } else if (argv[i] === "--instance") {
      instance = argv[i + 1] ?? null;
      i += 1;
      if (!instance) fail("--instance needs a subdomain.");
    } else if (argv[i] === "--through") {
      const value = argv[i + 1] ?? "";
      i += 1;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        fail("--through needs a date as YYYY-MM-DD.");
      }
      if (value > LAST_AFFECTED_SNAPSHOT_DATE) {
        fail(
          `--through ${value} is later than ${LAST_AFFECTED_SNAPSHOT_DATE}, the last ` +
            `snapshot the broken code could have written. Moving the bound later ` +
            `would delete rows written by the fixed cron, which are real. Refusing.`
        );
      }
      through = value;
    } else {
      fail(
        `Unknown option "${argv[i]}".\n` +
          `  Options: --dry-run, --yes, --instance <subdomain>, --through <YYYY-MM-DD>.`
      );
    }
  }

  return { dryRun, yes, instance, through };
}

// Counts, three ways, narrowing from the outer bound to the exact
// deletion predicate.
//
// Printed as three numbers rather than one because the innermost
// filter reads a jsonb key, and the way THAT goes wrong is by matching
// nothing and reporting a clean "0 rows to delete" — indistinguishable
// from an instance that is already repaired. Three numbers that should
// agree make a broken filter visible instead of reassuring.
export type Counts = {
  inRange: number;
  nullScored: number;
  toDelete: number;
  tableTotal: number;
};

async function countRows(
  db: SupabaseClient,
  through: string
): Promise<Counts> {
  const base = () =>
    db
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .in("discipline", GATED_DISCIPLINES as unknown as string[])
      .lte("snapshot_date", through);

  const [inRange, nullScored, toDelete, tableTotal] = await Promise.all([
    base(),
    base().is("score", null),
    base().is("score", null).eq("breakdown_json->>notEnabled", "true"),
    db.from(TABLE).select("id", { count: "exact", head: true }),
  ]);

  for (const res of [inRange, nullScored, toDelete, tableTotal]) {
    if (res.error) throw new Error(res.error.message);
  }

  return {
    inRange: inRange.count ?? 0,
    nullScored: nullScored.count ?? 0,
    toDelete: toDelete.count ?? 0,
    tableTotal: tableTotal.count ?? 0,
  };
}

// The predicate is repeated here rather than shared with countRows
// because a delete and a count must be independently readable. A
// helper that built both from one chain would make the deletion's
// WHERE clause something you have to go and look up.
async function deleteRows(
  db: SupabaseClient,
  through: string
): Promise<number> {
  const { data, error } = await db
    .from(TABLE)
    .delete()
    .in("discipline", GATED_DISCIPLINES as unknown as string[])
    .lte("snapshot_date", through)
    .is("score", null)
    .eq("breakdown_json->>notEnabled", "true")
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

export function describeCounts(c: Counts): string {
  return (
    `${c.inRange} gated rows in range, ${c.nullScored} unscored, ` +
    `${c.toDelete} to delete (table holds ${c.tableTotal})`
  );
}

async function repairInstance(
  row: RegistryRow,
  opts: { dryRun: boolean; through: string }
): Promise<InstanceOutcome> {
  const urlVar = `${row.env_prefix}_SUPABASE_URL`;
  const keyVar = `${row.env_prefix}_SUPABASE_SERVICE_KEY`;
  const url = process.env[urlVar]?.trim();
  const key = process.env[keyVar]?.trim();

  // BLOCKED, never skipped. An instance whose credentials are missing
  // is one this repair did not reach, and a silent skip is how it ends
  // up as the only database still carrying the bad rows with nothing
  // saying so. Same rule as migrate:instances.
  if (!url || !key) {
    const missing = [!url ? urlVar : null, !key ? keyVar : null]
      .filter(Boolean)
      .join(", ");
    return {
      subdomain: row.subdomain,
      state: "blocked",
      matched: 0,
      deleted: 0,
      detail: `${missing} not set in .env.provisioning`,
    };
  }

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const before = await countRows(db, opts.through);
    console.log(`  ${row.subdomain}: ${describeCounts(before)}`);

    // A jsonb filter that matches nothing looks exactly like a clean
    // instance. If there are gated rows in range but none survive the
    // full predicate, that is the filter failing, not the data being
    // fine, and continuing would report a successful no-op repair.
    if (before.inRange > 0 && before.toDelete === 0) {
      return {
        subdomain: row.subdomain,
        state: "failed",
        matched: 0,
        deleted: 0,
        detail:
          `${before.inRange} gated rows in range but 0 match the deletion ` +
          `predicate. Expected them to agree; the breakdown_json filter is ` +
          `not matching. Investigate before rerunning.`,
      };
    }

    if (before.toDelete === 0) {
      return {
        subdomain: row.subdomain,
        state: "ok",
        matched: 0,
        deleted: 0,
        detail: "nothing to delete",
      };
    }

    if (opts.dryRun) {
      return {
        subdomain: row.subdomain,
        state: "ok",
        matched: before.toDelete,
        deleted: 0,
        detail: `would delete ${before.toDelete}`,
      };
    }

    const deleted = await deleteRows(db, opts.through);
    const after = await countRows(db, opts.through);

    // Both halves are asserted. "None of the bad rows remain" and
    // "nothing else went with them" are different claims, and a
    // predicate that was wider than intended satisfies the first while
    // failing the second.
    const problems: string[] = [];
    if (after.toDelete !== 0) {
      problems.push(`${after.toDelete} rows still match after the delete`);
    }
    if (deleted !== before.toDelete) {
      problems.push(
        `deleted ${deleted} but expected ${before.toDelete}`
      );
    }
    if (after.tableTotal !== before.tableTotal - deleted) {
      problems.push(
        `table went from ${before.tableTotal} to ${after.tableTotal}, ` +
          `a change of ${before.tableTotal - after.tableTotal} for ${deleted} deletions`
      );
    }

    if (problems.length > 0) {
      return {
        subdomain: row.subdomain,
        state: "failed",
        matched: before.toDelete,
        deleted,
        detail: problems.join("; "),
      };
    }

    return {
      subdomain: row.subdomain,
      state: "ok",
      matched: before.toDelete,
      deleted,
      detail:
        `deleted ${deleted}, ${after.tableTotal} rows remain ` +
        `(was ${before.tableTotal})`,
    };
  } catch (err) {
    return {
      subdomain: row.subdomain,
      state: "failed",
      matched: 0,
      deleted: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function summaryLines(
  outcomes: InstanceOutcome[],
  dryRun: boolean
): string[] {
  const lines: string[] = [""];
  for (const o of outcomes) {
    const label =
      o.state === "ok" ? "OK" : o.state === "blocked" ? "BLOCKED" : "FAILED";
    lines.push(`  ${label.padEnd(8)}${o.subdomain.padEnd(16)}${o.detail}`);
  }
  const deleted = outcomes.reduce((n, o) => n + o.deleted, 0);
  const matched = outcomes.reduce((n, o) => n + o.matched, 0);
  const problems = outcomes.filter((o) => o.state !== "ok").length;
  lines.push("");
  lines.push(
    `  ${outcomes.length} instance${outcomes.length === 1 ? "" : "s"}: ` +
      (dryRun
        ? `${matched} rows would be deleted, ${problems} need attention`
        : `${deleted} rows deleted, ${problems} need attention`)
  );
  if (dryRun) lines.push("  --dry-run: nothing was deleted.");
  lines.push("");
  return lines;
}

async function confirm(total: number): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `\n  This deletes ${total} row${total === 1 ? "" : "s"} and is not reversible.\n` +
        `  Type the number to confirm: `
    );
    return answer.trim() === String(total);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const { dryRun, yes, instance, through } = parseArgs(process.argv.slice(2));

  const REQUIRED = [
    "CONTROL_PLANE_SUPABASE_URL",
    "CONTROL_PLANE_SUPABASE_SERVICE_KEY",
  ];
  const missing = REQUIRED.filter((n) => !process.env[n]?.trim());
  if (missing.length > 0) {
    fail(
      `Missing configuration:\n${missing.map((n) => `    ${n}`).join("\n")}\n\n` +
        `  These live in .env.provisioning. See .env.provisioning.example.`
    );
  }

  const control = createClient(
    process.env.CONTROL_PLANE_SUPABASE_URL as string,
    process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await control
    .from("instances")
    .select("subdomain, display_name, env_prefix, status")
    .order("subdomain");
  if (error) fail(`Couldn't read the registry: ${error.message}`);

  let rows = (data ?? []) as RegistryRow[];
  if (instance) {
    rows = rows.filter((r) => r.subdomain === instance);
    if (rows.length === 0) fail(`No registry row for "${instance}".`);
  }

  // Suspended instances are repaired too, unlike a migration. Their
  // data is untouched by suspension and the bad rows are just as wrong
  // there; skipping would leave a database that comes back online
  // carrying history nobody remembers is broken.
  if (rows.length === 0) {
    console.log("\n  No instances in the registry. Nothing to do.\n");
    return;
  }

  console.log("");
  console.log(
    `  ${dryRun ? "Checking" : "Repairing"} ${rows.length} instance${rows.length === 1 ? "" : "s"}`
  );
  console.log(`  Deleting: ${GATED_DISCIPLINES.join(", ")}`);
  console.log(`  Where: score is null, notEnabled, snapshot_date <= ${through}`);
  console.log("");

  // Count everything first, across every instance, so the confirmation
  // names the real total rather than a per-instance one. A prompt that
  // fires eight times is a prompt people learn to dismiss.
  const planned: InstanceOutcome[] = [];
  for (const row of rows) {
    planned.push(await repairInstance(row, { dryRun: true, through }));
  }

  const blocked = planned.filter((o) => o.state === "blocked");
  const failed = planned.filter((o) => o.state === "failed");
  const total = planned.reduce((n, o) => n + o.matched, 0);

  if (dryRun) {
    console.log(summaryLines(planned, true).join("\n"));
    if (blocked.length > 0 || failed.length > 0) process.exit(1);
    return;
  }

  // Refuse to delete anything while any instance is unreachable. A
  // partial repair across a fleet is the state hardest to reason about
  // later: some databases clean, some not, and no record of which.
  if (blocked.length > 0 || failed.length > 0) {
    console.log(summaryLines(planned, true).join("\n"));
    fail(
      `${blocked.length + failed.length} instance(s) could not be planned. ` +
        `Nothing was deleted. Fix those first — a fleet half-repaired is worse ` +
        `than one not repaired.`
    );
  }

  if (total === 0) {
    console.log(summaryLines(planned, false).join("\n"));
    console.log("  Nothing to delete on any instance.\n");
    return;
  }

  if (!yes && !(await confirm(total))) {
    fail("Confirmation did not match. Nothing was deleted.");
  }

  console.log("");
  const outcomes: InstanceOutcome[] = [];
  for (const row of rows) {
    outcomes.push(await repairInstance(row, { dryRun: false, through }));
  }

  console.log(summaryLines(outcomes, false).join("\n"));
  if (outcomes.some((o) => o.state !== "ok")) process.exit(1);
}

// Runs only when this file IS the process entry point. Importing it
// must never execute it — this one deletes rows, so an import that
// ran it would be the worst version of the bug scripts/entry-points.
// test.ts exists to prevent.
if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
