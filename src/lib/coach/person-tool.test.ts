import { describe, it, expect, vi, beforeEach } from "vitest";

// person_record: Aimee looks at a named person (open data, phase F).

const mocks = vi.hoisted(() => ({
  roster: [] as unknown[],
  record: vi.fn(),
  lastFilters: [] as string[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: async () => ({ subdomain: "t" }),
}));
vi.mock("./context", () => ({ loadPersonRecord: mocks.record }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const applied: string[] = [`from:${table}`];
      mocks.lastFilters.push(applied);
      const chain: Record<string, unknown> = {};
      const note =
        (op: string) =>
        (...a: unknown[]) => {
          applied.push(`${op}:${String(a[0])}=${String(a[1])}`);
          return chain;
        };
      Object.assign(chain, {
        select: note("select"),
        eq: note("eq"),
        maybeSingle: () => Promise.resolve({ data: table === "companies" ? { timezone: "America/Toronto" } : null, error: null }),
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: table === "profiles" ? mocks.roster : [], error: null }).then(r),
      });
      return chain;
    },
  }),
}));

import { matchName, makePersonRecordTool, type RosterPerson } from "./person-tool";

const P = (id: string, full_name: string, position: string | null = null, status = "active"): RosterPerson => ({
  id,
  full_name,
  position,
  status,
});
const ROSTER = [
  P("1", "Priya Nair", "Scheduler"),
  P("2", "Sam Ortiz"),
  P("3", "Sam Lee"),
  P("4", "Christopher Moore"),
  P("5", "José Álvarez"),
];

describe("matchName", () => {
  it("finds one person by first name, last name, full name or a first name and an initial", () => {
    for (const q of ["Priya", "nair", "Priya Nair", "  PRIYA   nair ", "Priya N"]) {
      const m = matchName(q, ROSTER);
      expect(m.kind, q).toBe("one");
      if (m.kind === "one") expect(m.person.id).toBe("1");
    }
  });

  it("lists everyone a shared first name could mean, and takes the full name", () => {
    const m = matchName("Sam", ROSTER);
    expect(m.kind).toBe("several");
    if (m.kind === "several") expect(m.people.map((p) => p.id).sort()).toEqual(["2", "3"]);
    const exact = matchName("Sam Lee", ROSTER);
    expect(exact.kind === "one" && exact.person.id).toBe("3");
  });

  it("takes a short form of three letters or more, and ignores accents", () => {
    expect(matchName("Chris", ROSTER)).toMatchObject({ kind: "one", person: { id: "4" } });
    expect(matchName("Jose Alvarez", ROSTER)).toMatchObject({ kind: "one", person: { id: "5" } });
  });

  it("never stretches a fragment, a lone initial or a stranger into somebody", () => {
    for (const q of ["P", "Pr", "Dana", "", "Priya Smith"]) {
      expect(matchName(q, ROSTER).kind, q).toBe("none");
    }
  });
});

describe("person_record", () => {
  const tool = makePersonRecordTool({ companyId: "co_1" });

  beforeEach(() => {
    mocks.roster = ROSTER;
    mocks.lastFilters = [];
    mocks.record.mockReset();
    mocks.record.mockResolvedValue({ personContext: "<person_context>Priya</person_context>", strengthsContext: null });
  });

  it("takes a name and nothing else: the schema has no id", () => {
    expect(Object.keys((tool.definition.input_schema as { properties: object }).properties)).toEqual(["name"]);
  });

  it("reads the matched person's record from this conversation's company", async () => {
    const out = (await tool.handler({ name: "Priya" })) as Record<string, unknown>;
    expect(out).toMatchObject({ status: "ok", name: "Priya Nair", position: "Scheduler", page: "/people/1" });
    expect(out.record).toContain("Priya");
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(), "co_1", "1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    const roster = mocks.lastFilters.find((f) => f[0] === "from:profiles")!;
    expect(roster).toContain("eq:company_id=co_1");
  });

  it("asks between people a name could mean, and reads nobody's record", async () => {
    const out = (await tool.handler({ name: "Sam" })) as { status: string; people: Array<{ name: string }> };
    expect(out.status).toBe("several");
    expect(out.people.map((p) => p.name).sort()).toEqual(["Sam Lee", "Sam Ortiz"]);
    expect(JSON.stringify(out)).not.toMatch(/"id"/);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("says nobody has the name rather than guessing", async () => {
    expect(await tool.handler({ name: "Dana" })).toEqual({ status: "not_found", name: "Dana" });
    expect(await tool.handler({})).toMatchObject({ status: "not_found" });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("finds nobody the caller cannot read: the roster is what RLS returned", async () => {
    mocks.roster = [];
    expect(await tool.handler({ name: "Priya" })).toEqual({ status: "not_found", name: "Priya" });
  });
});

// The caller's client only, and nobody's conversations or memory
// (investigation §5, guards 1 and 3). Comments are stripped so the
// file can say what it does not do.
describe("person_record reads as the caller", () => {
  it("no service client, and no conversation or memory reads", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/coach/person-tool.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/createSupabaseAdminClient/);
    expect(src).not.toMatch(/coaching_conversations|coaching_messages|coach_memories/);
  });
});
