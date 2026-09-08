import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

// Feature-gate resolution inside computeCompanyScorecard, specifically
// in a SESSION-LESS context.
//
// The bug these tests exist for: compute.ts resolved entitlements
// through the request-scoped getCompanyFeatures(), which reads with
// the cookie-scoped Supabase client. The weekly cron has no session,
// so that client speaks to PostgREST as `anon`; every policy on
// company_features is `to authenticated` (migration 0016), so the read
// came back EMPTY rather than failing. Both flags resolved false and
// all four feature-gated disciplines were written as
// { score: null, breakdown: { notEnabled: true } } on every snapshot
// from 2026-08-13 onward. /scorecard looked correct throughout,
// because the page computes live through a client that does carry a
// session — so nothing anywhere said the history was wrong.
//
// HOW THE SESSION-LESS CONTEXT IS SIMULATED. There is no Postgres in
// this environment, so we cannot assert the RLS behaviour directly.
// What we can assert is the property that RLS behaviour made
// load-bearing: compute.ts must never reach for the request-scoped
// client at all. So @/lib/supabase/server is mocked to THROW on use.
// Any code path that tries to resolve a session fails the test loudly
// instead of quietly returning [] the way production did. Run these
// against the pre-fix compute.ts and every one of them throws.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => {
    throw new Error(
      "createSupabaseServerClient() called in a session-less context. " +
        "Background work must resolve entitlements through the client it " +
        "was handed (getCompanyFeaturesWith), not through request cookies."
    );
  },
}));

const { computeCompanyScorecard, gatingFrom } = await import("./compute");
const { getCompanyFeaturesWith } = await import("@/lib/subscriptions/service");
const { createSupabaseServerClient } = await import("@/lib/supabase/server");

// Minimal stand-in for a service-role client. Returns whatever rows
// the test configured for a table and an empty list for everything
// else, which is enough for all eight scorers: each one handles an
// empty read by scoring zero or null rather than throwing.
function fakeServiceRoleClient(rows: Record<string, unknown[]>): SupabaseClient {
  const make = (table: string) => {
    const data = () => rows[table] ?? [];
    const chain: Record<string, unknown> = {};
    const pass = () => chain;
    Object.assign(chain, {
      select: pass,
      eq: pass,
      in: pass,
      gte: pass,
      lte: pass,
      not: pass,
      is: pass,
      order: pass,
      limit: pass,
      maybeSingle: () =>
        Promise.resolve({ data: data()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: data()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: data(), error: null }).then(resolve),
    });
    return chain;
  };
  return { from: (t: string) => make(t) } as unknown as SupabaseClient;
}

function withFeatures(...features: string[]): SupabaseClient {
  return fakeServiceRoleClient({
    company_features: features.map((feature) => ({ feature })),
  });
}

// The four feature-gated disciplines, and the feature each one needs.
const GATED = [
  ["measures", "performance_tracking"],
  ["meetings", "meeting_facilitation_review"],
  ["solution_seeking", "meeting_facilitation_review"],
  ["positive_framing", "meeting_facilitation_review"],
] as const;

function breakdownFor(
  result: Awaited<ReturnType<typeof computeCompanyScorecard>>,
  key: string
): Record<string, unknown> {
  const found = result.disciplines.find((d) => d.key === key);
  if (!found) throw new Error(`no discipline scored for ${key}`);
  return found.breakdown;
}

describe("the session-less guard itself", () => {
  // Without this, a future refactor that stops mocking the module (or
  // mocks it into something harmless) would leave every test below
  // passing for the wrong reason.
  it("throws if anything reaches for the request-scoped client", () => {
    expect(() => createSupabaseServerClient({} as never)).toThrow(
      /session-less context/
    );
  });
});

describe("computeCompanyScorecard — entitlements in a session-less context", () => {
  it("scores every gated discipline when the company holds both features", async () => {
    const db = withFeatures(
      "performance_tracking",
      "meeting_facilitation_review"
    );

    const result = await computeCompanyScorecard("co_1", db);

    // The assertion is "was this discipline gated OFF", not "did it
    // produce a number". solution_seeking and positive_framing
    // legitimately score null when the window holds no data, and that
    // is a different state from a feature being off — one is a tile
    // with nothing to say yet, the other is a module nobody bought.
    for (const [key] of GATED) {
      expect(breakdownFor(result, key)).not.toHaveProperty("notEnabled");
    }
    expect(result.gating).toEqual({ enabled: 4, total: 4 });
  });

  it("still gates disciplines off when the company genuinely holds no features", async () => {
    const db = withFeatures();

    const result = await computeCompanyScorecard("co_1", db);

    for (const [key] of GATED) {
      expect(breakdownFor(result, key)).toEqual({ notEnabled: true });
      expect(result.disciplines.find((d) => d.key === key)?.score).toBeNull();
    }
    expect(result.gating).toEqual({ enabled: 0, total: 4 });
  });

  it("resolves each feature independently rather than all-or-nothing", async () => {
    const db = withFeatures("performance_tracking");

    const result = await computeCompanyScorecard("co_1", db);

    expect(breakdownFor(result, "measures")).not.toHaveProperty("notEnabled");
    for (const key of ["meetings", "solution_seeking", "positive_framing"]) {
      expect(breakdownFor(result, key)).toEqual({ notEnabled: true });
    }
    expect(result.gating).toEqual({ enabled: 1, total: 4 });
  });

  it("never gates the four ungated disciplines, whatever the entitlements", async () => {
    const result = await computeCompanyScorecard("co_1", withFeatures());

    for (const key of ["foundation", "chart", "planning", "execution"]) {
      expect(breakdownFor(result, key)).not.toHaveProperty("notEnabled");
    }
  });
});

describe("getCompanyFeaturesWith", () => {
  it("reads through the client it is given", async () => {
    const db = withFeatures("classroom", "performance_tracking");

    expect(await getCompanyFeaturesWith(db, "co_1")).toEqual([
      "classroom",
      "performance_tracking",
    ]);
  });

  it("returns an empty list for a company with no entitlements", async () => {
    expect(await getCompanyFeaturesWith(withFeatures(), "co_1")).toEqual([]);
  });
});

describe("gatingFrom", () => {
  it("counts the gated disciplines a feature set switches on", () => {
    expect(gatingFrom([])).toEqual({ enabled: 0, total: 4 });
    expect(gatingFrom(["performance_tracking"])).toEqual({
      enabled: 1,
      total: 4,
    });
    // One feature, three disciplines: meetings, solution_seeking and
    // positive_framing all hang off meeting_facilitation_review.
    expect(gatingFrom(["meeting_facilitation_review"])).toEqual({
      enabled: 3,
      total: 4,
    });
    expect(
      gatingFrom(["performance_tracking", "meeting_facilitation_review"])
    ).toEqual({ enabled: 4, total: 4 });
  });

  it("ignores features that gate nothing on the scorecard", () => {
    expect(gatingFrom(["classroom", "execution"])).toEqual({
      enabled: 0,
      total: 4,
    });
  });
});

describe("compute.ts (source guard)", () => {
  // Companion to the behavioural tests above. Those prove the current
  // code does not reach for request state; this pins that nobody
  // reintroduces the import that made it possible, which is a
  // one-word change away and reads perfectly innocent in a diff.
  //
  // Comments are stripped first, the same way rls-privileges.test.ts
  // strips them out of migration SQL. The prose above the fix names
  // the very helpers this forbids, and a guard that fires on its own
  // explanation is a guard people delete.
  const source = codeOnly(
    readFileSync(path.resolve(__dirname, "compute.ts"), "utf8")
  );

  it("resolves entitlements through the caller's client", () => {
    expect(source).toMatch(/getCompanyFeaturesWith\(db, companyId\)/);
  });

  it("does not use the request-scoped entitlement helpers", () => {
    expect(source).not.toMatch(/\bcompanyHasFeature\b/);
    expect(source).not.toMatch(/\bgetCompanyFeatures\b(?!With)/);
  });

  it("does not build a request-scoped Supabase client", () => {
    expect(source).not.toMatch(/createSupabaseServerClient/);
  });
});

// Source with comments removed, so a guard reads the code and not the
// prose describing it.
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}
