import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Policy pin for the two similarity RPCs behind findSimilarOpenItem.
// They are SECURITY DEFINER, take p_company_id as a parameter, and
// do no membership check of their own, so whoever can EXECUTE them
// can read any tenant's open commitment descriptions and issue
// titles. Migration 0144 granted them to `authenticated`; 0160
// revoked that. This test replays every GRANT / REVOKE on those
// functions across the migration history, in order, and asserts the
// net result is service_role only. If a future migration re-grants
// them to authenticated or anon, this fails.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const FUNCTIONS = ["find_similar_open_commitment", "find_similar_open_issue"];

// Roles may appear as a comma list ("public, anon, authenticated").
function splitRoles(list: string): string[] {
  return list
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

function effectiveGrantees(fn: string): Set<string> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const grantees = new Set<string>();
  const grantRe = new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+to\\s+([^;]+);`,
    "gi"
  );
  const revokeRe = new RegExp(
    `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+from\\s+([^;]+);`,
    "gi"
  );
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // Walk statements in file order so a revoke after a grant (or
    // vice versa) in the same file is applied in sequence.
    const ops: Array<{ index: number; kind: "grant" | "revoke"; roles: string[] }> = [];
    for (const m of sql.matchAll(grantRe)) {
      ops.push({ index: m.index ?? 0, kind: "grant", roles: splitRoles(m[1]) });
    }
    for (const m of sql.matchAll(revokeRe)) {
      ops.push({ index: m.index ?? 0, kind: "revoke", roles: splitRoles(m[1]) });
    }
    ops.sort((a, b) => a.index - b.index);
    for (const op of ops) {
      for (const role of op.roles) {
        if (op.kind === "grant") grantees.add(role);
        else grantees.delete(role);
      }
    }
  }
  return grantees;
}

describe("similarity RPC grants", () => {
  for (const fn of FUNCTIONS) {
    it(`${fn} is executable by service_role only`, () => {
      const grantees = effectiveGrantees(fn);
      expect(grantees.has("service_role")).toBe(true);
      expect(grantees.has("authenticated")).toBe(false);
      expect(grantees.has("anon")).toBe(false);
      expect(grantees.has("public")).toBe(false);
    });
  }

  it("the history actually contains the 0144 grant, so the replay is not vacuous", () => {
    // Guards the test itself: if the regex silently stopped matching
    // the migration text, the assertions above would pass for the
    // wrong reason.
    const sql = readFileSync(
      path.join(MIGRATIONS_DIR, "0144_meeting_analyses_issues_json.sql"),
      "utf8"
    );
    expect(sql).toMatch(
      /grant execute on function public\.find_similar_open_commitment\([^)]*\) to authenticated;/
    );
  });
});
