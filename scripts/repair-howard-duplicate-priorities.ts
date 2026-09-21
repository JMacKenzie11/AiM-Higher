/**
 * scripts/repair-howard-duplicate-priorities.ts
 *
 * Deletes the quarterly priorities Howard Concrete Pumping's plan
 * was typed into one level too high, and which were re-entered
 * correctly as commitments a quarter of an hour later.
 *
 * Usage:
 *   npm run repair:howard-priorities -- --dry-run
 *   npm run repair:howard-priorities
 *   npm run repair:howard-priorities -- --yes
 *   npm run repair:howard-priorities -- --include-unbacked
 *
 * WHAT HAPPENED. On 2026-08-18, between 00:59:05 and 01:05:35, 16
 * rows were created in `priorities` under the goal "Preventative
 * Maintenance Software", one every ~20 seconds. They are the steps
 * of a software rollout — research, demos, pilot, decide, configure,
 * train, review, expand — which is a commitment list, not sixteen
 * quarterly priorities.
 *
 * At 01:07:36 the priority those steps belong under was created, and
 * between 01:22:14 and 01:33:32 the same list was entered again as
 * commitments linked to it. That second pass is correct. Nobody
 * deleted the first.
 *
 * No software did this. Nothing in the codebase creates a priority
 * from a commitment, and createPriorityAction inserts one row per
 * form submission. It was typed twice.
 *
 * WHAT IT DELETES, AND WHAT IT WILL NOT. Only a priority that is
 * BOTH under that goal AND has a commitment on the same company
 * whose description matches its title exactly. Fourteen of the
 * sixteen qualify.
 *
 * The other two had no commitment anywhere:
 *
 *   "Confirm candidate solutions to evaluate: existing Cleveland…"
 *   "Research publicly available capabilities for Raken and Fleet…"
 *
 * Deleting those destroys the only copy of that work, so the default
 * run leaves them alone and reports them. `--include-unbacked` is
 * the product owner saying to delete them anyway, and it is a
 * separate flag precisely because the two cases are not the same
 * decision: one is removing a duplicate, the other is discarding
 * content. Jason made that call on 2026-09-21.
 *
 * The flag does NOT relax the other guard. A priority with a
 * commitment hanging off it is never deleted, with or without it.
 *
 * NOTHING CASCADES. commitments.priority_id is the only foreign key
 * pointing at priorities and it is ON DELETE SET NULL, so a delete
 * here cannot remove a commitment — at worst it would unlink one.
 * None of the sixteen has a commitment linked to it, and the script
 * refuses to delete any row that does rather than trusting that.
 *
 * Config comes from .env.provisioning, the same rule
 * migrate:instances follows. Production only: the other instances do
 * not have this company.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isEntryPoint } from "./lib/entry-point.ts";

try {
  process.loadEnvFile(".env.provisioning");
} catch {
  // Missing values are reported by name below.
}

const COMPANY = "Howard Concrete Pumping";
const GOAL = "Preventative Maintenance Software";

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

export type Candidate = {
  id: string;
  title: string;
  copies: number;
  linked: number;
};

export type Plan = { deletable: Candidate[]; kept: Candidate[] };

export type PlanOptions = { includeUnbacked?: boolean };

// Pure, so the rule can be tested without a database.
//
// A row is deletable only if the work survives somewhere else (a
// commitment with the same text) AND nothing hangs off it. Both
// halves matter and they fail differently: the first protects the
// content, the second protects rows that would be silently unlinked.
export function planFor(
  candidates: readonly Candidate[],
  opts: PlanOptions = {}
): Plan {
  const deletable: Candidate[] = [];
  const kept: Candidate[] = [];
  for (const c of candidates) {
    // Never, under either mode. This is the guard that stops a
    // delete quietly unlinking somebody's commitments through the
    // ON DELETE SET NULL on commitments.priority_id.
    if (c.linked > 0) {
      kept.push(c);
      continue;
    }
    if (c.copies > 0 || opts.includeUnbacked) deletable.push(c);
    else kept.push(c);
  }
  return { deletable, kept };
}

export function parseArgs(argv: string[]): {
  dryRun: boolean;
  yes: boolean;
  includeUnbacked: boolean;
} {
  let dryRun = false;
  let yes = false;
  let includeUnbacked = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--yes") yes = true;
    else if (arg === "--include-unbacked") includeUnbacked = true;
    else
      fail(
        `Unknown option "${arg}".\n` +
          `  Options: --dry-run, --yes, --include-unbacked.`
      );
  }
  return { dryRun, yes, includeUnbacked };
}

async function gather(db: SupabaseClient): Promise<Candidate[]> {
  const { data: company, error: cErr } = await db
    .from("companies")
    .select("id")
    .eq("name", COMPANY)
    .maybeSingle<{ id: string }>();
  if (cErr) throw new Error(cErr.message);
  if (!company) fail(`No company named "${COMPANY}" on this instance.`);

  const { data: goal, error: gErr } = await db
    .from("annual_goals")
    .select("id")
    .eq("company_id", company.id)
    .eq("title", GOAL)
    .maybeSingle<{ id: string }>();
  if (gErr) throw new Error(gErr.message);
  if (!goal) fail(`No goal titled "${GOAL}" for ${COMPANY}.`);

  const { data: rows, error: pErr } = await db
    .from("priorities")
    .select("id, title, archived")
    .eq("annual_goal_id", goal.id);
  if (pErr) throw new Error(pErr.message);

  const { data: commitments, error: mErr } = await db
    .from("commitments")
    .select("description, priority_id, deleted_at")
    .eq("company_id", company.id);
  if (mErr) throw new Error(mErr.message);

  const live = (commitments ?? []).filter(
    (c) => (c as { deleted_at: string | null }).deleted_at === null
  ) as Array<{ description: string; priority_id: string | null }>;

  const norm = (s: string) => s.trim().toLowerCase();
  const byText = new Map<string, number>();
  const byPriority = new Map<string, number>();
  for (const c of live) {
    byText.set(norm(c.description), (byText.get(norm(c.description)) ?? 0) + 1);
    if (c.priority_id) {
      byPriority.set(c.priority_id, (byPriority.get(c.priority_id) ?? 0) + 1);
    }
  }

  return ((rows ?? []) as Array<{ id: string; title: string; archived: boolean }>)
    .filter((r) => !r.archived)
    .map((r) => ({
      id: r.id,
      title: r.title,
      copies: byText.get(norm(r.title)) ?? 0,
      linked: byPriority.get(r.id) ?? 0,
    }));
}

async function main(): Promise<void> {
  const { dryRun, yes, includeUnbacked } = parseArgs(process.argv.slice(2));

  // PROD_* by name, not a generic pair, because this script is about
  // one company on one instance. Naming the instance in the variable
  // is what stops it being pointed somewhere else by accident.
  const url = process.env.PROD_SUPABASE_URL?.trim();
  const key = process.env.PROD_SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) {
    fail(
      "PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_KEY are not set. " +
        "They live in .env.provisioning; see .env.provisioning.example."
    );
  }

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const candidates = await gather(db);
  const { deletable, kept } = planFor(candidates, { includeUnbacked });

  console.log("");
  console.log(`  ${COMPANY} — priorities under "${GOAL}"`);
  console.log(`  ${candidates.length} live row(s)`);
  console.log("");
  for (const c of deletable) {
    const note = c.copies === 0 ? "  (no commitment copy — --include-unbacked)" : "";
    console.log(`  DELETE  ${c.title.slice(0, 60)}${note}`);
  }
  for (const c of kept) {
    const why =
      c.linked > 0
        ? `${c.linked} commitment(s) hang off it`
        : "no commitment anywhere carries this text";
    console.log(`  KEEP    ${c.title.slice(0, 50)} — ${why}`);
  }
  console.log("");

  if (deletable.length === 0) {
    console.log("  Nothing to delete.\n");
    return;
  }

  if (dryRun) {
    console.log(`  --dry-run: nothing was deleted. ${deletable.length} would go.\n`);
    return;
  }

  if (!yes) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = await rl.question(
        `  This deletes ${deletable.length} priorit${deletable.length === 1 ? "y" : "ies"} and is not reversible.\n` +
          `  Type the number to confirm: `
      );
      if (answer.trim() !== String(deletable.length)) {
        fail("Not confirmed. Nothing was deleted.");
      }
    } finally {
      rl.close();
    }
  }

  const ids = deletable.map((c) => c.id);
  const { data, error } = await db
    .from("priorities")
    .delete()
    .in("id", ids)
    .select("id");
  if (error) fail(`Delete failed: ${error.message}`);

  const deleted = (data ?? []).length;
  const after = planFor(await gather(db), { includeUnbacked });

  // Both halves asserted. "The duplicates are gone" and "nothing else
  // went with them" are different claims.
  if (deleted !== ids.length) {
    fail(`Deleted ${deleted} but expected ${ids.length}.`);
  }
  if (after.deletable.length !== 0) {
    fail(`${after.deletable.length} still match after the delete.`);
  }
  if (after.kept.length !== kept.length) {
    fail(
      `Rows that should have been kept changed: ${kept.length} before, ` +
        `${after.kept.length} after.`
    );
  }

  console.log(`  Deleted ${deleted}. ${after.kept.length} row(s) kept.\n`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
