import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Guard against the whole class of bug found on 2026-09-02.
//
// Migration 0139 renamed the commitment statuses: 'kept' became
// kept_on_time / kept_late, and a CHECK constraint now rejects the old
// value. Migration 0011 had already dropped 'carried'. Several places
// were never updated, and every one of them failed SILENTLY, because a
// status string that matches no row simply returns nothing:
//
//   * cascade-actions wrote status:'kept', violating the constraint,
//     which made "Mark complete" fail outright on any priority with an
//     open commitment.
//   * the execution scorer, the platform admin dashboard and the AI
//     week-in-review brief all counted status === 'kept', so every
//     company's follow-through read 0%.
//   * the priority_progress view counted 'kept' and 'carried', so every
//     priority, goal, focus area and the dashboard Execution figure
//     displayed 0%.
//
// Nothing caught it: the unit tests mock the database, so the CHECK
// constraint never runs, and one test actively asserted the wrong
// value. This scans source instead.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(REPO_ROOT, "src");
const MIGRATIONS = path.join(REPO_ROOT, "supabase", "migrations");

// The only values a commitments.status may hold (migration 0139).
const LIVE_STATUSES = ["open", "kept_on_time", "kept_late", "missed"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

// Matches a dead status used in a DATABASE position: a status filter,
// a status write, or a comparison against a row's status field.
//
// Deliberately narrow. "kept" is still a perfectly good UI filter-pill
// value (the pill collapses kept_on_time + kept_late into one "did the
// work" filter) and a display label, and flagging those would make this
// test noise that someone eventually deletes. The lookbehind excludes
// `filters.status`, which is that pill, not a row value.
//
// Known limit, stated rather than papered over: a comparison against a
// bare local — `statuses.filter((s) => s === "kept")`, which is exactly
// the shape of the brief.ts bug — is not distinguishable from UI code
// by pattern alone. The query-position and SQL checks are the
// load-bearing ones; this is a second net, not a proof.
const DEAD_IN_DB_POSITION = [
  // .eq("status", "kept")  /  .in("status", [..., "kept", ...])
  /\.(?:eq|in)\(\s*["']status["']\s*,\s*[^)]*["'](?:kept|carried)["']/,
  // status: "kept"  (an insert/update payload)
  /\bstatus:\s*["'](?:kept|carried)["']/,
  // c.status === "kept", but not filters.status === "kept"
  /(?<!filters\.)(?<!filter\.)\bstatus\s*[=!]==?\s*["'](?:kept|carried)["']/,
];

describe("commitment status values", () => {
  it("no source file uses a dead status in a database position", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      // The marketing mock renders fake rows that never touch the DB.
      if (file.includes(path.join("(marketing)", "mocks"))) continue;
      // This file necessarily names the dead values.
      if (file.endsWith("status-values.test.ts")) continue;
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, i) => {
        // Skip comments — several files legitimately explain the
        // migration in prose.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        if (DEAD_IN_DB_POSITION.some((re) => re.test(line))) {
          offenders.push(`${path.relative(REPO_ROOT, file)}:${i + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it("the current priority_progress definition counts only live statuses", () => {
    // The view is redefined in 0163; take the LAST definition, since
    // 0007 still contains the broken original by design (migrations
    // are history, not current state).
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    let latest = "";
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
      if (/create\s+or\s+replace\s+view\s+public\.priority_progress/i.test(sql)) {
        latest = sql;
      }
    }
    expect(latest).not.toBe("");

    // Strip SQL comments before checking — the migration explains the
    // dead values in prose.
    const body = latest
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");

    expect(body).toMatch(/kept_on_time/);
    expect(body).toMatch(/kept_late/);
    // No dead value in a status comparison.
    expect(body).not.toMatch(/status\s*=\s*'kept'/);
    expect(body).not.toMatch(/status\s*=\s*'carried'/);
    expect(body).not.toMatch(/status\s*<>\s*'carried'/);
    // And it must exclude rows the UI hides.
    expect(body).toMatch(/deleted_at is null/i);
    expect(body).toMatch(/parked_at is null/i);
  });

  it("the replacement view keeps the original column names, in order", () => {
    // CREATE OR REPLACE VIEW can only ADD trailing columns. It cannot
    // rename, reorder, or retype an existing one — Postgres rejects
    // the whole statement (42P16). Dropping and recreating is not an
    // escape hatch either: annual_goal_progress depends on this view,
    // so DROP would need CASCADE and would take the rollups with it.
    //
    // This bit on the first attempt at 0163: carried_count went from
    // coalesce(sum(...), 0) — a bigint — to a bare 0, an integer, and
    // the migration failed in the SQL editor. The fix was an explicit
    // ::bigint. This test compares the projected column list of the
    // original definition against the latest one so the next person
    // finds out here rather than in production.
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const defs: string[] = [];
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
      const m = sql.match(
        /create\s+or\s+replace\s+view\s+public\.priority_progress\s+as([\s\S]*?)from\s+public\.priorities/i
      );
      if (m) defs.push(m[1]);
    }
    expect(defs.length).toBeGreaterThanOrEqual(2);

    // Pull the "as <name>" aliases in projection order.
    const aliases = (body: string) =>
      Array.from(body.matchAll(/\bas\s+([a-z_]+)\s*(?:,|$)/gim)).map(
        (m) => m[1]
      );

    const original = aliases(defs[0]);
    const latest = aliases(defs[defs.length - 1]);

    expect(original.length).toBeGreaterThan(0);
    expect(latest).toEqual(original);
  });

  it("casts carried_count to bigint so the column type is unchanged", () => {
    // The specific trap above. A bare 0 here is an integer and the
    // replacement is rejected.
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    let latest = "";
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
      if (/create\s+or\s+replace\s+view\s+public\.priority_progress/i.test(sql)) {
        latest = sql;
      }
    }
    expect(latest).toMatch(/0::bigint\s+as carried_count/);
  });

  it("documents the live status set so a future rename updates this list", () => {
    // Pins the set itself. If someone adds a fifth status, this fails
    // and they are pointed at every consumer above.
    expect(LIVE_STATUSES).toEqual([
      "open",
      "kept_on_time",
      "kept_late",
      "missed",
    ]);
  });
});
