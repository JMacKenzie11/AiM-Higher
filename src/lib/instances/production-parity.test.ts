import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { resolveInstance } from "./resolve";

// Production parity, end to end.
//
// Every other test in this directory exercises one half: resolve.ts
// with an injected lookup, or registry.ts with a mocked control
// plane. This one runs the real pair — resolveInstance calling the
// real lookupInstance — against a registry holding the row the
// production deployment actually depends on, and asserts the config
// that comes out is built from the PROD_SUPABASE_* variables.
//
// It exists because the failure it guards against is invisible.
// The row names an env_prefix and the keys live in the environment,
// so "PROD" in the row and PROD_SUPABASE_URL in Vercel are joined by
// nothing but a string. Break that join and a production request does
// not error: it resolves to null, gets rewritten to
// /instance-not-found, and the whole site serves a 200 saying nobody
// lives here.
//
// Only the network boundary is mocked, at @supabase/supabase-js, the
// same seam registry.test.ts uses. Nothing here opens a socket.

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const createClient = vi.fn((url: string, key: string, options?: unknown) => {
    void url;
    void key;
    void options;
    return { from };
  });
  return { maybeSingle, eq, select, from, createClient };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

// The row scripts/seed-instances.ts writes, in the shape migration
// 0169 stores it. Kept literal rather than imported so a change to
// the seed script has to be made here too, deliberately.
const PRODUCTION_ROW = {
  subdomain: "@",
  display_name: "AiMS Higher",
  env_prefix: "PROD",
  status: "active",
};

// Resolution consults these before the registry, so a developer's
// own environment must not decide the outcome of this test.
const OVERRIDE_VARS = [
  "LOCAL_INSTANCE_SUPABASE_URL",
  "LOCAL_INSTANCE_SUPABASE_ANON_KEY",
  "LOCAL_INSTANCE_SUPABASE_SERVICE_KEY",
  "PREVIEW_INSTANCE_SUPABASE_URL",
  "PREVIEW_INSTANCE_SUPABASE_ANON_KEY",
  "PREVIEW_INSTANCE_SUPABASE_SERVICE_KEY",
];

let savedOverrides: Record<string, string | undefined> = {};

async function importRegistry() {
  return import("./registry");
}

beforeEach(async () => {
  vi.clearAllMocks();

  vi.stubEnv("CONTROL_PLANE_SUPABASE_URL", "https://control.supabase.co");
  vi.stubEnv("CONTROL_PLANE_SUPABASE_SERVICE_KEY", "control-service-key");
  // The variables Vercel holds on the Production environment.
  vi.stubEnv("PROD_SUPABASE_URL", "https://prod-project.supabase.co");
  vi.stubEnv("PROD_SUPABASE_ANON_KEY", "prod-anon-key");
  vi.stubEnv("PROD_SUPABASE_SERVICE_KEY", "prod-service-key");

  savedOverrides = {};
  for (const name of OVERRIDE_VARS) {
    savedOverrides[name] = process.env[name];
    delete process.env[name];
  }

  const { clearInstanceCache } = await importRegistry();
  clearInstanceCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const name of OVERRIDE_VARS) {
    if (savedOverrides[name] === undefined) delete process.env[name];
    else process.env[name] = savedOverrides[name];
  }
});

function registryHolds(row: Record<string, unknown> | null) {
  mocks.maybeSingle.mockResolvedValue({ data: row, error: null });
}

const EXPECTED = {
  subdomain: "@",
  displayName: "AiMS Higher",
  supabaseUrl: "https://prod-project.supabase.co",
  supabaseAnonKey: "prod-anon-key",
  supabaseServiceKey: "prod-service-key",
  status: "active",
};

describe("the production hostname, resolved end to end", () => {
  it("resolves www.aims-hq.com to the PROD env values", async () => {
    registryHolds(PRODUCTION_ROW);
    const { lookupInstance } = await importRegistry();

    const resolved = await resolveInstance(
      "www.aims-hq.com",
      process.env,
      lookupInstance,
    );

    // The whole join under test: hostname → "@" → the row → "PROD" →
    // these three variables.
    expect(resolved).toEqual(EXPECTED);
    expect(mocks.from).toHaveBeenCalledWith("instances");
    expect(mocks.eq).toHaveBeenCalledWith("subdomain", "@");
  });

  it("resolves the bare apex to the same instance", async () => {
    registryHolds(PRODUCTION_ROW);
    const { lookupInstance } = await importRegistry();

    // aims-hq.com and www.aims-hq.com are one deployment, and both
    // are live: the apex 308s to www today, but neither may 404.
    expect(
      await resolveInstance("aims-hq.com", process.env, lookupInstance),
    ).toEqual(EXPECTED);
    expect(mocks.eq).toHaveBeenCalledWith("subdomain", "@");
  });

  it("resolves the same on a port and in mixed case", async () => {
    registryHolds(PRODUCTION_ROW);
    const { lookupInstance } = await importRegistry();

    expect(
      await resolveInstance("WWW.AiMS-HQ.com:443", process.env, lookupInstance),
    ).toEqual(EXPECTED);
  });

  it("never reaches the control plane through the app's own variables", async () => {
    registryHolds(PRODUCTION_ROW);
    const { lookupInstance } = await importRegistry();
    await resolveInstance("www.aims-hq.com", process.env, lookupInstance);

    // The client is a module-level singleton and may have been built
    // by an earlier test. Either way it is addressed by CONTROL_PLANE_*
    // and never by PROD_* or NEXT_PUBLIC_*.
    for (const call of mocks.createClient.mock.calls) {
      expect(call[0]).toBe("https://control.supabase.co");
      expect(call[1]).toBe("control-service-key");
    }
  });

  it("refuses to resolve when the row's variables are missing from the environment", async () => {
    // The deployment mistake this is here to catch: the row says
    // "PROD" and Vercel has no PROD_SUPABASE_* on that environment.
    // It must fail closed, not fall through to some other database.
    registryHolds(PRODUCTION_ROW);
    vi.stubEnv("PROD_SUPABASE_ANON_KEY", "");
    const { lookupInstance } = await importRegistry();

    expect(
      await resolveInstance("www.aims-hq.com", process.env, lookupInstance),
    ).toBeNull();
  });

  it("refuses to resolve when the row has not been seeded", async () => {
    // Before scripts/seed-instances.ts has ever run. The env being
    // perfectly configured does not help: no row, no instance.
    registryHolds(null);
    const { lookupInstance } = await importRegistry();

    expect(
      await resolveInstance("www.aims-hq.com", process.env, lookupInstance),
    ).toBeNull();
  });

  it("does not hand an unregistered subdomain the production database", async () => {
    // "@" is a row, not a fallback. A hostname that misses resolves
    // to nothing rather than to production.
    registryHolds(null);
    const { lookupInstance } = await importRegistry();

    expect(
      await resolveInstance("acme.aims-hq.com", process.env, lookupInstance),
    ).toBeNull();
    expect(mocks.eq).toHaveBeenCalledWith("subdomain", "acme");
  });
});
