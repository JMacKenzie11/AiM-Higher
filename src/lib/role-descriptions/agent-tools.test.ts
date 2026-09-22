import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  single: {} as Record<string, unknown>,
  foundation: null as unknown,
  filters: [] as string[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: async () => ({ subdomain: "t" }),
}));
vi.mock("@/lib/foundation/service", () => ({
  getFoundation: async () => mocks.foundation,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const applied: string[] = [`from:${table}`];
      mocks.filters.push(applied);
      const chain: Record<string, unknown> = {};
      const note =
        (op: string) =>
        (...a: unknown[]) => {
          applied.push(`${op}:${String(a[0])}`);
          return chain;
        };
      Object.assign(chain, {
        select: note("select"),
        eq: note("eq"),
        in: note("in"),
        order: note("order"),
        maybeSingle: async () => ({
          data: mocks.single[table] ?? null,
          error: null,
        }),
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: mocks.tables[table] ?? [], error: null }).then(r),
      });
      return chain;
    },
  }),
}));

import { buildRoleDescriptionTools } from "./agent-tools";

function toolNamed(name: string) {
  const t = buildRoleDescriptionTools({ companyId: "co_1" }).find(
    (x) => x.definition.name === name
  );
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

function reset() {
  mocks.tables = {};
  mocks.single = {};
  mocks.foundation = null;
  mocks.filters = [];
}

const FULL_FOUNDATION = {
  foundation: {
    purpose_statement: "Build things that last.",
    purpose_context: "Because the alternative is rework.",
    vision: "Every project on schedule by 2030.",
  },
  coreValues: [
    { title: "Honesty first", body: "Say the hard thing early." },
    { title: "Own it", body: null },
  ],
  differentiators: [{ title: "We answer the phone", body: "Always." }],
};

describe("get_foundation", () => {
  it("returns the company, the purpose, the vision, the values and the differentiators", async () => {
    reset();
    mocks.single = { companies: { name: "Benson Seafood", industry: "Seafood" } };
    mocks.foundation = FULL_FOUNDATION;

    const out = (await toolNamed("get_foundation").handler({})) as {
      status: string;
      company_name: string;
      industry: string;
      purpose: { statement: string; context: string };
      vision: string;
      core_values: Array<{ title: string; body: string | null }>;
      differentiators: Array<{ title: string }>;
    };

    expect(out.status).toBe("ok");
    expect(out.company_name).toBe("Benson Seafood");
    expect(out.industry).toBe("Seafood");
    expect(out.purpose.statement).toBe("Build things that last.");
    expect(out.purpose.context).toBe("Because the alternative is rework.");
    expect(out.vision).toBe("Every project on schedule by 2030.");
    expect(out.core_values).toEqual([
      { title: "Honesty first", body: "Say the hard thing early." },
      { title: "Own it", body: null },
    ]);
    expect(out.differentiators[0]?.title).toBe("We answer the phone");
  });

  // "Empty sections come back as empty arrays or null, never
  // omitted." A missing key reads to the model as a section that
  // does not exist in this product, which is a different sentence
  // from "your company has not filled this in".
  it("returns every section even when the company has filled in none of them", async () => {
    reset();
    mocks.single = { companies: { name: "Empty Co", industry: null } };
    mocks.foundation = { foundation: null, coreValues: [], differentiators: [] };

    const out = (await toolNamed("get_foundation").handler({})) as Record<
      string,
      unknown
    >;

    for (const key of [
      "company_name",
      "industry",
      "purpose",
      "vision",
      "core_values",
      "differentiators",
    ]) {
      expect(Object.keys(out)).toContain(key);
    }
    expect(out.industry).toBeNull();
    expect(out.vision).toBeNull();
    expect(out.purpose).toEqual({ statement: null, context: null });
    expect(out.core_values).toEqual([]);
    expect(out.differentiators).toEqual([]);
  });

  it("takes no input at all", () => {
    const schema = toolNamed("get_foundation").definition.input_schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual([]);
    expect(schema.required).toEqual([]);
  });
});

const TREE = [
  { id: "ops", title: "Operations", description: null, parent_function_id: "int", sort_order: 1, lead_id: "p_2" },
  { id: "vis", title: "Visionary", description: "The top seat", parent_function_id: null, sort_order: 5, lead_id: "p_1" },
  { id: "mkt", title: "Marketing", description: null, parent_function_id: "int", sort_order: 0, lead_id: null },
  { id: "int", title: "Integrator", description: null, parent_function_id: null, sort_order: 9, lead_id: "p_1" },
];

describe("list_functions", () => {
  it("returns the chart in chart order, Visionary first", async () => {
    reset();
    mocks.tables = {
      functions: TREE,
      function_roles: [],
      success_measures: [],
      profiles: [{ id: "p_1", full_name: "Dana Whitfield" }, { id: "p_2", full_name: "Jon Billings" }],
    };

    const out = (await toolNamed("list_functions").handler({})) as {
      status: string;
      functions: Array<{ id: string; title: string; lead: string | null }>;
    };

    expect(out.status).toBe("ok");
    // Visionary is pinned first and Integrator second DESPITE their
    // sort_order being 5 and 9 against Operations' 1. That is the
    // rule /measures uses and it is easy to lose in a rewrite.
    expect(out.functions.map((f) => f.title)).toEqual([
      "Visionary",
      "Integrator",
      "Marketing",
      "Operations",
    ]);
  });

  it("returns the Lead's name, not their id", async () => {
    reset();
    mocks.tables = {
      functions: TREE,
      function_roles: [],
      success_measures: [],
      profiles: [{ id: "p_1", full_name: "Dana Whitfield" }, { id: "p_2", full_name: "Jon Billings" }],
    };
    const out = (await toolNamed("list_functions").handler({})) as {
      functions: Array<{ title: string; lead: string | null }>;
    };
    const byTitle = new Map(out.functions.map((f) => [f.title, f.lead]));
    expect(byTitle.get("Visionary")).toBe("Dana Whitfield");
    expect(byTitle.get("Operations")).toBe("Jon Billings");
    // An empty seat is null, not "Unassigned": the model writes the
    // sentence, and it should not inherit our UI's word for nobody.
    expect(byTitle.get("Marketing")).toBeNull();
  });

  it("flags the baseline responsibility and keeps it first", async () => {
    reset();
    mocks.tables = {
      functions: TREE,
      function_roles: [
        { function_id: "vis", title: "Lead, Track, Decide", body: null, is_default: true },
        { function_id: "vis", title: "Set the direction", body: "Annually", is_default: false },
      ],
      success_measures: [],
      profiles: [],
    };
    const out = (await toolNamed("list_functions").handler({})) as {
      functions: Array<{
        title: string;
        responsibilities: Array<{ title: string; is_baseline: boolean }>;
      }>;
    };
    const vis = out.functions.find((f) => f.title === "Visionary")!;
    expect(vis.responsibilities[0]).toEqual({
      title: "Lead, Track, Decide",
      body: null,
      is_baseline: true,
    });
    expect(vis.responsibilities[1]?.is_baseline).toBe(false);
  });

  it("carries a critical success factor's target, type, direction and frequency", async () => {
    reset();
    mocks.tables = {
      functions: TREE,
      function_roles: [],
      success_measures: [
        {
          function_id: "mkt",
          description: "Qualified leads handed to sales",
          target: "12",
          value_type: "number",
          target_direction: "higher_is_better",
          update_frequency: "weekly",
        },
        {
          function_id: "mkt",
          description: "Brand awareness",
          target: null,
          value_type: "text",
          target_direction: "higher_is_better",
          update_frequency: "monthly",
        },
      ],
      profiles: [],
    };
    const out = (await toolNamed("list_functions").handler({})) as {
      functions: Array<{
        title: string;
        critical_success_factors: Array<{ description: string; target: string | null }>;
      }>;
    };
    const mkt = out.functions.find((f) => f.title === "Marketing")!;
    expect(mkt.critical_success_factors).toHaveLength(2);
    expect(mkt.critical_success_factors[0]).toEqual({
      description: "Qualified leads handed to sales",
      target: "12",
      value_type: "number",
      target_direction: "higher_is_better",
      update_frequency: "weekly",
    });
    // A factor with no target is normal and survives as null, not as
    // a missing key or a zero.
    expect(mkt.critical_success_factors[1]?.target).toBeNull();
  });

  it("filters out archived functions and archived factors in the query", async () => {
    reset();
    mocks.tables = { functions: TREE, function_roles: [], success_measures: [], profiles: [] };
    await toolNamed("list_functions").handler({});
    const fnQuery = mocks.filters.find((f) => f[0] === "from:functions")!;
    expect(fnQuery).toContain("eq:archived");
    const csfQuery = mocks.filters.find((f) => f[0] === "from:success_measures")!;
    expect(csfQuery).toContain("eq:archived");
  });

  it("returns empty rather than an error when the chart has nothing on it", async () => {
    reset();
    mocks.tables = { functions: [] };
    const out = (await toolNamed("list_functions").handler({})) as { status: string };
    expect(out.status).toBe("empty");
  });

  it("takes no input at all", () => {
    const schema = toolNamed("list_functions").definition.input_schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual([]);
    expect(schema.required).toEqual([]);
  });
});

// The property that matters most, and the one a behavioural test
// cannot reach: RLS is the boundary, so a tool that reached for the
// service client would silently widen visibility for every role at
// once. Failure mode E5. Same guard as coach/history-tools.test.ts,
// for the same reason.
describe("the role description tools run as the caller", () => {
  it("no service client, no conversation reads, and no company id from the model", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      "src/lib/role-descriptions/agent-tools.ts",
      "utf8"
    ).replace(/^\s*\/\/.*$/gm, "");

    expect(src).not.toMatch(/createSupabaseAdminClient/);
    expect(src).not.toMatch(/coaching_conversations|coaching_messages/);
    // Nothing about a person beyond the name in a seat. The agent
    // describes a ROLE; who might hold it is a different document.
    expect(src).not.toMatch(/profile_id/);
    // Neither tool takes an identifier. The company is closed over,
    // so the model cannot name one — a stronger property than "the
    // database will catch it".
    expect(src).not.toMatch(/input_schema:\s*\{\s*type:\s*"object",\s*properties:\s*\{\s*\w/);
  });
});
