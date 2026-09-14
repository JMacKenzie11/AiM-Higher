// Post-apply verification for the fleet.
//
// WHY THIS EXISTS. `migrate:instances` reports what it applied, and
// that report is the only evidence the ritual has ever had. It is
// evidence about the RUN, not about the fleet: an instance the run
// never reached, a push that reported success against a database that
// rolled it back, or a registry row added after the apply all leave a
// clean-looking run behind an inconsistent fleet. This reads the
// answer back out of every instance instead of trusting the write.
//
// READ-ONLY BY CONSTRUCTION. It takes no client capable of writing —
// only `appliedVersionsFor`, which the caller wires to a single
// `select version from supabase_migrations.schema_migrations`. There
// is no code path here that can change a database.
//
// BLOCKED IS A FAILURE, NOT A SKIP. An instance whose credentials are
// missing or whose database will not answer is one this verification
// did not reach, and reporting "all good" for the instances that did
// answer is how the unreachable one ends up as the only database
// still behind with nothing saying so. Same rule as migrate:instances.

import {
  pendingMigrations,
  latestVersion,
  resolveTarget,
  selectMigratableRows,
  type RegistryRow,
} from "./migrate.ts";
import type { InstanceState } from "./state.ts";

export type InstanceVerdict =
  | { subdomain: string; state: "current"; version: string }
  | {
      subdomain: string;
      state: "behind";
      version: string | null;
      missing: readonly string[];
    }
  | { subdomain: string; state: "blocked"; reason: string };

export async function verifyAllInstances(opts: {
  rows: readonly RegistryRow[];
  env: Record<string, string | undefined>;
  readState: (subdomain: string) => InstanceState | null;
  localMigrations: readonly string[];
  appliedVersionsFor: (ref: string) => Promise<Set<string>>;
}): Promise<InstanceVerdict[]> {
  const { migrate: rows } = selectMigratableRows(opts.rows);
  const verdicts: InstanceVerdict[] = [];

  for (const row of rows) {
    const target = resolveTarget({
      row,
      env: opts.env,
      readState: opts.readState,
    });
    if (!target.ok) {
      verdicts.push({
        subdomain: row.subdomain,
        state: "blocked",
        reason: target.reason,
      });
      continue;
    }

    let applied: Set<string>;
    try {
      applied = await opts.appliedVersionsFor(target.ref);
    } catch (error) {
      // A database that will not answer is NOT "nothing applied".
      // migrate:instances treats an absent ledger that way on purpose,
      // because it is about to push into it; here the same guess would
      // report a healthy instance as catastrophically behind, or hide
      // a network failure behind a number.
      verdicts.push({
        subdomain: row.subdomain,
        state: "blocked",
        reason: `couldn't read the migration ledger: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }

    const missing = pendingMigrations(opts.localMigrations, applied);
    if (missing.length === 0) {
      verdicts.push({
        subdomain: row.subdomain,
        state: "current",
        version: latestVersion(opts.localMigrations) ?? "(none)",
      });
      continue;
    }
    verdicts.push({
      subdomain: row.subdomain,
      state: "behind",
      version: highestApplied(applied),
      missing,
    });
  }

  return verdicts;
}

function highestApplied(applied: Set<string>): string | null {
  let best: string | null = null;
  for (const v of applied) if (best === null || v > best) best = v;
  return best;
}

// The whole point is a verdict somebody can act on, so the summary
// leads with the failure and names the instances rather than a count.
export function summarize(
  verdicts: readonly InstanceVerdict[],
  expected: string | null
): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  for (const v of verdicts) {
    if (v.state === "current") {
      lines.push(`    ${v.subdomain}  up to date at ${v.version}`);
    } else if (v.state === "behind") {
      lines.push(
        `    ${v.subdomain}  BEHIND at ${v.version ?? "(nothing applied)"} — ` +
          `missing ${v.missing.length}: ${v.missing.join(", ")}`
      );
    } else {
      lines.push(`    ${v.subdomain}  BLOCKED — ${v.reason}`);
    }
  }

  const behind = verdicts.filter((v) => v.state === "behind").length;
  const blocked = verdicts.filter((v) => v.state === "blocked").length;

  lines.push("");
  if (verdicts.length === 0) {
    // Not a pass. A fleet with nothing in it means the registry read
    // came back empty, which is a question, not a clean bill.
    lines.push("  No instances to verify — check the registry.");
    return { ok: false, lines };
  }
  if (behind === 0 && blocked === 0) {
    lines.push(
      `  All ${verdicts.length} instances at ${expected ?? "(none)"}.`
    );
    return { ok: true, lines };
  }
  lines.push(
    `  ${behind} behind, ${blocked} unreachable, ` +
      `${verdicts.length - behind - blocked} up to date.`
  );
  return { ok: false, lines };
}
