import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source checks, in the shape of measures/counts-agree.test.ts. The
// database's allow list (0270) is the boundary; these keep the MCP code
// from asking for more than the menu in the first place.

const root = join(__dirname, "..", "..", "..");
const reads = readFileSync(join(__dirname, "reads.ts"), "utf8");
const route = readFileSync(join(root, "src/app/api/mcp/route.ts"), "utf8");
const log = readFileSync(join(__dirname, "log.ts"), "utf8");

describe("fixed columns only", () => {
  it("never selects every column", () => {
    for (const src of [reads, route]) {
      expect(src).not.toMatch(/\.select\(\s*["'`]\s*\*/);
      expect(src).not.toMatch(/\.select\(\s*\)/);
    }
  });

  it("names its columns in every select", () => {
    const selects = [...reads.matchAll(/\.select\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
    expect(selects.length).toBeGreaterThan(10);
    for (const s of selects) {
      // A string literal or the shared commitment list, never a variable
      // built from input.
      expect(s === "COMMITMENT_COLS" || /^["`][a-z_, ]+["`]$/.test(s)).toBe(true);
    }
  });
});

describe("the menu, and nothing else", () => {
  const tables = [...reads.matchAll(/\.from\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
  // Tables named through the two helpers that take a table name.
  const viaPart = [...reads.matchAll(/(?:part\(|titles\(db, )"([a-z_]+)"/g)].map((m) => m[1]);

  it("finds the helpers' tables too", () => {
    expect(viaPart).toEqual(expect.arrayContaining(["function_roles", "annual_goals", "strategic_focus_areas"]));
  });

  it("reads only tables on the allow list (0270)", () => {
    const menu = new Set([
      "commitments", "commitment_occurrences", "issues", "success_measures",
      "success_measure_entries", "success_measure_targets", "functions",
      "function_roles", "function_decision_rights", "function_competencies",
      "companies", "profiles", "guide_assignments", "portfolio_assignments",
      "quarters", "strategic_focus_areas", "annual_goals", "priorities",
      "company_foundation", "foundation_items",
    ]);
    for (const t of [...tables, ...viaPart]) expect(menu.has(t)).toBe(true);
  });

  it("calls no function but the meeting summaries one", () => {
    const rpcs = [...reads.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(rpcs).toEqual(["assistant_meeting_summaries"]);
  });

  it("never names transcripts, facilitation reviews or Aimee", () => {
    for (const src of [reads, route]) {
      // As a quoted identifier, which is how a query would name it.
      expect(src).not.toMatch(/["'`][a-z_]*(transcript|facilitation|coach|insight)[a-z_]*["'`]/);
    }
  });

  it("writes nothing on the assistant's token", () => {
    for (const src of [reads, route]) {
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
  });
});

describe("the service role is the log's and nothing else's", () => {
  it("is used only in log.ts, and only on assistant_actions", () => {
    expect(reads).not.toContain("createSupabaseAdminClient");
    expect(route).not.toContain("createSupabaseAdminClient");
    const tables = [...log.matchAll(/\.from\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["assistant_actions"]));
  });
});
