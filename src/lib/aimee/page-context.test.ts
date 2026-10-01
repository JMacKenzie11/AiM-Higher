import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

import { describePageContext, parsePageContext } from "./page-context";
import { RECORD_SOURCES } from "./record-sources";

// WHAT AIMEE IS TOLD ABOUT THE PAGE BESIDE HER PANEL (Step 4).
//
// The browser names a page and, at most, a record's pattern and id.
// The record is read through the client the route passes in, which is
// the person's own session, so RLS decides. These tests hold the half
// that is code: malformed input is dropped, a page the role cannot
// open says nothing, and a record the database does not return (the
// shape of an RLS refusal) is never described. The database half, that
// a team member really gets no row from another company, is the
// harness probe "aimee page context" over the same RECORD_SOURCES.

const FUNCTION_ID = "11111111-1111-4111-8111-111111111111";

// A session client that answers with `row` for any record, and notes
// which tables were asked.
function client(row: Record<string, unknown> | null) {
  const asked: string[] = [];
  const supabase = {
    from(table: string) {
      asked.push(table);
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return b;
    },
  };
  return { supabase: supabase as never, asked };
}

describe("parsePageContext", () => {
  it("keeps a path and a known record, and drops the query string", () => {
    expect(
      parsePageContext({ path: "/chart?x=1", record: { pattern: "/chart/function/[id]", id: FUNCTION_ID } })
    ).toEqual({ path: "/chart", record: { pattern: "/chart/function/[id]", id: FUNCTION_ID } });
  });

  it("drops a record that is not a known pattern and a uuid, and anything that is not a path", () => {
    expect(parsePageContext({ path: "/chart", record: { pattern: "/admin/agents", id: FUNCTION_ID } })?.record).toBeNull();
    expect(parsePageContext({ path: "/chart", record: { pattern: "/chart/function/[id]", id: "1 or 1=1" } })?.record).toBeNull();
    expect(parsePageContext({ path: "https://elsewhere.example/x" })).toBeNull();
    expect(parsePageContext("nope")).toBeNull();
    expect(parsePageContext(null)).toBeNull();
  });
});

describe("describePageContext", () => {
  it("names the page and the record the database returned", async () => {
    const { supabase, asked } = client({ title: "Customer Success", description: "Keeps clients." });
    const block = await describePageContext(
      supabase,
      { path: "/chart", record: { pattern: "/chart/function/[id]", id: FUNCTION_ID } },
      "team_member",
      ["execution"]
    );
    expect(asked).toEqual(["functions"]);
    expect(block).toContain("<current_page>");
    expect(block).toContain("(/chart)");
    expect(block).toContain('"Customer Success"');
    expect(block).toContain("Keeps clients.");
  });

  it("says nothing about a record the database did not return to this person", async () => {
    // What RLS looks like from here: no row. A team member asking about
    // another company's function, by id, gets the page and nothing else.
    const { supabase } = client(null);
    const block = await describePageContext(
      supabase,
      { path: `/chart/function/${FUNCTION_ID}`, record: null },
      "team_member",
      ["execution"]
    );
    expect(block).toContain("<current_page>");
    expect(block).not.toMatch(/Open function|Its description|untitled/i);
  });

  it("says nothing at all about a page this role cannot open, or a feature the company has not got", async () => {
    const { supabase, asked } = client({ title: "secret" });
    expect(await describePageContext(supabase, { path: "/admin/agents", record: null }, "team_member", ["execution"])).toBe("");
    expect(
      await describePageContext(
        supabase,
        { path: "/plan", record: { pattern: "/chart/function/[id]", id: FUNCTION_ID } },
        "team_member",
        []
      )
    ).toBe("");
    expect(asked).toEqual([]);
  });

  it("reads a record page's own id from the path, not from what the browser claims is open", async () => {
    const { supabase, asked } = client({ title: "Grow the pipeline", description: null });
    const block = await describePageContext(
      supabase,
      {
        path: `/plan/goal/${FUNCTION_ID}`,
        record: { pattern: "/chart/function/[id]", id: "22222222-2222-4222-8222-222222222222" },
      },
      "team_member",
      ["execution"]
    );
    expect(asked).toEqual(["annual_goals"]);
    expect(block).toContain('Open annual goal: "Grow the pipeline"');
  });
});

describe("the service role never reads a page's record", () => {
  it("is not imported where records are loaded", async () => {
    for (const file of ["page-context.ts", "record-sources.ts"]) {
      const src = await fs.readFile(path.join(__dirname, file), "utf8");
      const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect(code, file).not.toMatch(/createSupabaseAdminClient|supabase\/admin|SUPABASE_SERVICE/);
    }
  });

  it("covers every record page on the list with a table", () => {
    for (const [pattern, source] of Object.entries(RECORD_SOURCES)) {
      expect(pattern).toMatch(/\[id\]/);
      expect(source.table).toMatch(/^[a-z_]+$/);
    }
  });
});
