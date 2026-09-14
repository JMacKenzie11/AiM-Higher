import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  applied: [] as string[],
  error: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: async () => ({ subdomain: "t" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      mocks.applied.push(`from:${table}`);
      const chain: Record<string, unknown> = {};
      const note =
        (op: string) =>
        (...a: unknown[]) => {
          mocks.applied.push(`${op}:${String(a[0])}:${String(a[1] ?? "")}`);
          return chain;
        };
      Object.assign(chain, {
        select: note("select"),
        order: note("order"),
        limit: note("limit"),
        gte: note("gte"),
        ilike: note("ilike"),
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: mocks.rows, error: mocks.error }).then(r),
      });
      return chain;
    },
  }),
}));

import { makeMemoryLookupTool } from "./memory-tool";

const tool = () => makeMemoryLookupTool();

describe("memory_lookup has no identifier vocabulary", () => {
  it("its schema cannot express 'somebody else'", () => {
    // The structural claim. A tool that accepted a person id would be
    // relying on RLS to refuse it; this cannot form the request.
    const schema = tool().definition.input_schema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties).sort()).toEqual(["days_back", "query"]);
    for (const forbidden of ["profile_id", "person_id", "subject", "scope", "user_id"]) {
      expect(schema.properties).not.toHaveProperty(forbidden);
    }
  });

  it("reads as the caller and filters by no id at all", async () => {
    const src = (await import("node:fs")).readFileSync(
      "src/lib/coach/memory-tool.ts",
      "utf8"
    ).replace(/^\s*\/\/.*$/gm, "");
    // RLS is the boundary: coach_memories admits profile_id =
    // auth.uid() and nothing else. A service client would bypass it;
    // an explicit id would be a second, weaker place to get it wrong.
    expect(src).not.toMatch(/createSupabaseAdminClient/);
    expect(src).not.toMatch(/eq\(\s*["']profile_id["']/);
  });
});

describe("memory_lookup behaviour", () => {
  it("returns the remembered rows with their kind", async () => {
    mocks.rows = [
      { kind: "said", content: "Wants to delegate dispatch", created_at: "2026-09-01T10:00:00Z" },
      { kind: "inferred", content: "Avoids conflict with reports", created_at: "2026-08-02T10:00:00Z" },
    ];
    mocks.error = null;
    const out = (await tool().handler({})) as {
      status: string;
      memories: Array<{ kind: string; remembered_on: string }>;
    };
    expect(out.status).toBe("ok");
    // The kind rides through: the provenance rules cannot work if the
    // coach cannot tell what it may quote plainly.
    expect(out.memories.map((m) => m.kind)).toEqual(["said", "inferred"]);
    expect(out.memories[0]?.remembered_on).toBe("2026-09-01");
  });

  it("says nothing is remembered rather than returning an empty list", async () => {
    mocks.rows = [];
    mocks.error = null;
    const out = (await tool().handler({ query: "dispatch" })) as {
      status: string;
      reason: string;
    };
    expect(out.status).toBe("empty");
    expect(out.reason).toContain("matching that");
  });

  it("does not report an error as an absence", async () => {
    // "There is no history" and "I could not read the history" are
    // different answers, and only one of them is honest here.
    mocks.rows = [];
    mocks.error = { code: "42501", message: "denied" };
    const out = (await tool().handler({})) as { status: string };
    expect(out.status).toBe("error");
  });

  it("escapes LIKE wildcards in the person's own words", async () => {
    mocks.rows = [];
    mocks.error = null;
    mocks.applied = [];
    await tool().handler({ query: "50% done_now" });
    const ilike = mocks.applied.find((a) => a.startsWith("ilike:"));
    expect(ilike).toContain("50\\%");
    expect(ilike).toContain("done\\_now");
  });

  it("clamps days_back to the documented range", async () => {
    mocks.rows = [];
    mocks.error = null;
    mocks.applied = [];
    await tool().handler({ days_back: 99999 });
    expect(mocks.applied.some((a) => a.startsWith("gte:created_at"))).toBe(true);
  });
});
