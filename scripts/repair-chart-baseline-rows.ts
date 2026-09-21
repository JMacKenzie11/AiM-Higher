/**
 * scripts/repair-chart-baseline-rows.ts
 *
 * Removes the duplicate baseline responsibility the Functional Chart
 * Builder wrote onto every function of every chart it applied, and
 * restores the baseline row anywhere it is missing.
 *
 * Usage:
 *   npm run repair:chart-baseline -- --dry-run     # the plan, touching nothing
 *   npm run repair:chart-baseline                  # apply, with a typed confirmation
 *   npm run repair:chart-baseline -- --yes         # apply without the prompt
 *   npm run repair:chart-baseline -- --instance promiseone
 *
 * WHAT WENT WRONG. Migration 0107 installs a trigger that writes one
 * `is_default` row holding "Lead, Track, Decide" at sort_order 0 on
 * every function as it is created — top seats included, because top
 * seats are functions. The chart-builder prompt ALSO asked the model
 * to emit that responsibility, in the older "Leadership, Management,
 * and Accountability (LMA)" wording, and applyChartProposalAction
 * inserted it at sort_order 1. Every function of every applied chart
 * therefore carried the same idea twice, under two names. Fixed at
 * source in #269: the model no longer emits it, the parser strips it
 * if it arrives anyway, and the card renders LTD from a constant.
 *
 * This is the history that fix does not reach.
 *
 * WHY DELETION IS SAFE. The rows being deleted are duplicates of a
 * row that is still there — the `is_default` one, which is protected
 * from update and delete by RLS and cannot have been lost. Nothing
 * unique is destroyed: the function keeps its baseline, and keeps
 * every responsibility a human actually chose.
 *
 * WHAT IT WILL NOT TOUCH.
 *   - `is_default` rows. Never, under any predicate. They are the row
 *     being preserved, and RLS protects them from the app for the
 *     same reason.
 *   - A baseline-shaped row on a function that has NO `is_default`
 *     row. There, the duplicate is the only baseline the function
 *     has, and deleting it would remove the thing this script exists
 *     to protect. Reported as `orphan` and left alone.
 *
 * THE MATCHER IS IMPORTED, NOT REIMPLEMENTED. isBaselineRole is the
 * same function the parser uses to strip these on the way in. A copy
 * of the rule in SQL would be a second definition free to drift from
 * the first, and the two would disagree exactly when it mattered.
 *
 * ADDING A MISSING BASELINE. A function with no `is_default` row gets
 * one. In practice the trigger means there are none, and the audit
 * behind this script found none — but "the trigger guarantees it" is
 * a claim about code, and this script's whole subject is a database
 * that disagreed with a claim about code. The insert is bounded by a
 * partial unique index, so a second baseline cannot be created even
 * if this is run twice.
 *
 * Config comes from .env.provisioning and nowhere else, the same rule
 * migrate:instances follows.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { BASELINE_ROLE, isBaselineRole } from "@/lib/chart/baseline-role";
import { isEntryPoint } from "./lib/entry-point.ts";

try {
  process.loadEnvFile(".env.provisioning");
} catch {
  // Missing values are reported by name below.
}

const TABLE = "function_roles";

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

export type RoleRow = {
  id: string;
  function_id: string;
  title: string;
  is_default: boolean;
};

export type Plan = {
  // Non-default, baseline-shaped, on a function that still has its
  // is_default row. These are the duplicates.
  deleteIds: string[];
  // Functions with no is_default row at all.
  missingBaselineFunctionIds: string[];
  // Non-default, baseline-shaped, on a function with NO is_default
  // row — the function's only baseline. Left alone, reported.
  orphanIds: string[];
  totalRoles: number;
};

// Pure, so the decision can be tested without a database. Every row
// of function_roles for one instance goes in; what to do comes out.
export function planFor(roles: readonly RoleRow[]): Plan {
  const hasDefault = new Set<string>();
  const functionIds = new Set<string>();
  for (const r of roles) {
    functionIds.add(r.function_id);
    if (r.is_default) hasDefault.add(r.function_id);
  }

  const deleteIds: string[] = [];
  const orphanIds: string[] = [];
  for (const r of roles) {
    // The guard that matters. An is_default row is never a candidate,
    // whatever its title says.
    if (r.is_default) continue;
    if (!isBaselineRole(r.title)) continue;
    if (hasDefault.has(r.function_id)) deleteIds.push(r.id);
    else orphanIds.push(r.id);
  }

  return {
    deleteIds,
    missingBaselineFunctionIds: [...functionIds].filter(
      (id) => !hasDefault.has(id)
    ),
    orphanIds,
    totalRoles: roles.length,
  };
}

export function describePlan(p: Plan): string {
  const parts = [`${p.deleteIds.length} duplicate(s) to delete`];
  if (p.missingBaselineFunctionIds.length > 0) {
    parts.push(`${p.missingBaselineFunctionIds.length} function(s) missing a baseline`);
  }
  if (p.orphanIds.length > 0) {
    parts.push(`${p.orphanIds.length} orphan(s) left alone`);
  }
  return `${parts.join(", ")} (table holds ${p.totalRoles})`;
}

export type InstanceOutcome = {
  subdomain: string;
  state: "ok" | "blocked" | "failed";
  planned: number;
  deleted: number;
  inserted: number;
  detail: string;
};

export function parseArgs(argv: string[]): {
  dryRun: boolean;
  yes: boolean;
  instance: string | null;
} {
  let dryRun = false;
  let yes = false;
  let instance: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") {
      dryRun = true;
    } else if (argv[i] === "--yes") {
      yes = true;
    } else if (argv[i] === "--instance") {
      instance = argv[i + 1] ?? null;
      i += 1;
      if (!instance) fail("--instance needs a subdomain.");
    } else {
      fail(
        `Unknown option "${argv[i]}".\n` +
          `  Options: --dry-run, --yes, --instance <subdomain>.`
      );
    }
  }

  return { dryRun, yes, instance };
}

// Every role row, paged. A fleet instance holds thousands at most, and
// the decision needs all of them at once: whether a row is a duplicate
// depends on whether a SIBLING row exists.
async function readAllRoles(db: SupabaseClient): Promise<RoleRow[]> {
  const out: RoleRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(TABLE)
      .select("id, function_id, title, is_default")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RoleRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// Named so the WHERE clause is readable at the call site. `.in(id)` on
// a list the plan produced, plus an explicit is_default guard that is
// redundant with planFor and kept anyway: this is the delete, and the
// delete should state its own safety rather than inherit it.
export async function deleteDuplicates(
  db: SupabaseClient,
  ids: readonly string[]
): Promise<number> {
  let deleted = 0;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db
      .from(TABLE)
      .delete()
      .in("id", ids.slice(i, i + CHUNK) as string[])
      .eq("is_default", false)
      .select("id");
    if (error) throw new Error(error.message);
    deleted += (data ?? []).length;
  }
  return deleted;
}

export async function insertMissingBaselines(
  db: SupabaseClient,
  functionIds: readonly string[]
): Promise<number> {
  if (functionIds.length === 0) return 0;
  const { data, error } = await db
    .from(TABLE)
    .insert(
      functionIds.map((function_id) => ({
        function_id,
        title: BASELINE_ROLE,
        body: null,
        sort_order: 0,
        is_default: true,
      }))
    )
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

// What was found, by company and function, so the plan can be read
// rather than trusted. Printed for a dry run; this is the surface a
// person actually checks before typing the number.
async function describeRows(
  db: SupabaseClient,
  ids: readonly string[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from(TABLE)
    .select("id, title, functions(title, companies(name))")
    .in("id", ids as string[]);
  if (error) throw new Error(error.message);
  type Joined = {
    title: string;
    functions: { title: string; companies: { name: string } | null } | null;
  };
  return ((data ?? []) as unknown as Joined[])
    .map(
      (r) =>
        `${r.functions?.companies?.name ?? "?"} · ${r.functions?.title ?? "?"} ` +
        `→ "${r.title.slice(0, 60)}"`
    )
    .sort();
}

async function repairInstance(
  row: RegistryRow,
  opts: { dryRun: boolean; verbose: boolean }
): Promise<InstanceOutcome> {
  const urlVar = `${row.env_prefix}_SUPABASE_URL`;
  const keyVar = `${row.env_prefix}_SUPABASE_SERVICE_KEY`;
  const url = process.env[urlVar]?.trim();
  const key = process.env[keyVar]?.trim();

  // BLOCKED, never skipped. An instance this repair did not reach is
  // the one that ends up as the only database still carrying the bad
  // rows with nothing saying so. Same rule as migrate:instances.
  if (!url || !key) {
    const missing = [!url ? urlVar : null, !key ? keyVar : null]
      .filter(Boolean)
      .join(", ");
    return {
      subdomain: row.subdomain,
      state: "blocked",
      planned: 0,
      deleted: 0,
      inserted: 0,
      detail: `${missing} not set in .env.provisioning`,
    };
  }

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const before = planFor(await readAllRoles(db));
    console.log(`  ${row.subdomain}: ${describePlan(before)}`);

    if (opts.verbose) {
      for (const line of await describeRows(db, before.deleteIds)) {
        console.log(`      ${line}`);
      }
      for (const line of await describeRows(db, before.orphanIds)) {
        console.log(`      ORPHAN (kept) ${line}`);
      }
    }

    const work = before.deleteIds.length + before.missingBaselineFunctionIds.length;
    if (work === 0) {
      return {
        subdomain: row.subdomain,
        state: "ok",
        planned: 0,
        deleted: 0,
        inserted: 0,
        detail: "nothing to do",
      };
    }

    if (opts.dryRun) {
      return {
        subdomain: row.subdomain,
        state: "ok",
        planned: work,
        deleted: 0,
        inserted: 0,
        detail: `would delete ${before.deleteIds.length}, insert ${before.missingBaselineFunctionIds.length}`,
      };
    }

    const deleted = await deleteDuplicates(db, before.deleteIds);
    const inserted = await insertMissingBaselines(
      db,
      before.missingBaselineFunctionIds
    );
    const after = planFor(await readAllRoles(db));

    // Three claims, asserted separately. "The duplicates are gone",
    // "the right number went", and "nothing else went with them" are
    // different things, and a predicate wider than intended satisfies
    // the first while failing the third.
    const problems: string[] = [];
    if (after.deleteIds.length !== 0) {
      problems.push(`${after.deleteIds.length} duplicates still match`);
    }
    if (deleted !== before.deleteIds.length) {
      problems.push(`deleted ${deleted}, expected ${before.deleteIds.length}`);
    }
    if (after.missingBaselineFunctionIds.length !== 0) {
      problems.push(
        `${after.missingBaselineFunctionIds.length} functions still have no baseline`
      );
    }
    const expectedTotal = before.totalRoles - deleted + inserted;
    if (after.totalRoles !== expectedTotal) {
      problems.push(
        `table went from ${before.totalRoles} to ${after.totalRoles}, ` +
          `expected ${expectedTotal}`
      );
    }

    return {
      subdomain: row.subdomain,
      state: problems.length > 0 ? "failed" : "ok",
      planned: work,
      deleted,
      inserted,
      detail:
        problems.length > 0
          ? problems.join("; ")
          : `deleted ${deleted}, inserted ${inserted}, ${after.totalRoles} rows remain ` +
            `(was ${before.totalRoles})`,
    };
  } catch (err) {
    return {
      subdomain: row.subdomain,
      state: "failed",
      planned: 0,
      deleted: 0,
      inserted: 0,
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
  const inserted = outcomes.reduce((n, o) => n + o.inserted, 0);
  const planned = outcomes.reduce((n, o) => n + o.planned, 0);
  const problems = outcomes.filter((o) => o.state !== "ok").length;
  lines.push("");
  lines.push(
    `  ${outcomes.length} instance${outcomes.length === 1 ? "" : "s"}: ` +
      (dryRun
        ? `${planned} change(s) planned, ${problems} need attention`
        : `${deleted} deleted, ${inserted} inserted, ${problems} need attention`)
  );
  if (dryRun) lines.push("  --dry-run: nothing was written.");
  lines.push("");
  return lines;
}

async function confirm(total: number): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `\n  This changes ${total} row${total === 1 ? "" : "s"} and is not reversible.\n` +
        `  Type the number to confirm: `
    );
    return answer.trim() === String(total);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const { dryRun, yes, instance } = parseArgs(process.argv.slice(2));

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
  if (rows.length === 0) {
    console.log("\n  No instances in the registry. Nothing to do.\n");
    return;
  }

  console.log("");
  console.log(
    `  ${dryRun ? "Checking" : "Repairing"} ${rows.length} instance${rows.length === 1 ? "" : "s"}`
  );
  console.log(`  Deleting: non-default rows whose title is baseline-shaped,`);
  console.log(`            on functions that still have their is_default row`);
  console.log(`  Adding:   "${BASELINE_ROLE}" to any function with no baseline`);
  console.log("");

  // Plan every instance first, so the confirmation names the fleet
  // total. A prompt that fires once per instance is a prompt people
  // learn to dismiss.
  const planned: InstanceOutcome[] = [];
  for (const row of rows) {
    planned.push(await repairInstance(row, { dryRun: true, verbose: true }));
  }

  const blocked = planned.filter((o) => o.state === "blocked");
  const failed = planned.filter((o) => o.state === "failed");
  const total = planned.reduce((n, o) => n + o.planned, 0);

  if (dryRun) {
    console.log(summaryLines(planned, true).join("\n"));
    if (blocked.length > 0 || failed.length > 0) process.exit(1);
    return;
  }

  // Refuse to write anything while any instance is unreachable. A
  // fleet half-repaired is the state hardest to reason about later.
  if (blocked.length > 0 || failed.length > 0) {
    console.log(summaryLines(planned, true).join("\n"));
    fail(
      `${blocked.length + failed.length} instance(s) could not be planned. ` +
        `Nothing was written. Fix those first.`
    );
  }

  if (total === 0) {
    console.log(summaryLines(planned, false).join("\n"));
    return;
  }

  if (!yes && !(await confirm(total))) {
    fail("Not confirmed. Nothing was written.");
  }

  const outcomes: InstanceOutcome[] = [];
  for (const row of rows) {
    outcomes.push(await repairInstance(row, { dryRun: false, verbose: false }));
  }
  console.log(summaryLines(outcomes, false).join("\n"));
  if (outcomes.some((o) => o.state !== "ok")) process.exit(1);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
