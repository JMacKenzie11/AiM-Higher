import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Registry tests. The control plane client is mocked at the
// @supabase/supabase-js boundary, so nothing here opens a socket.
// Every test primes one terminal spy (maybeSingle) and reads the
// InstanceConfig that comes back out.
//
// The env vars matter as much as the row does: the point of the
// registry is that a row names a prefix and the keys live in the
// environment, so the tests assert which env names are read, not
// just that a config appears.

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  // Typed params so the assertions below can read call[0] / call[1]
  // (which URL and key the control plane client was built with).
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

const ACME_ROW = {
  subdomain: "acme",
  display_name: "Acme Industries",
  env_prefix: "ACME",
  status: "active",
};

function rowFound(row: Record<string, unknown>) {
  mocks.maybeSingle.mockResolvedValue({ data: row, error: null });
}

function noRow() {
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
}

async function importRegistry() {
  return import("./registry");
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("CONTROL_PLANE_SUPABASE_URL", "https://control.supabase.co");
  vi.stubEnv("CONTROL_PLANE_SUPABASE_SERVICE_KEY", "control-service-key");
  vi.stubEnv("ACME_SUPABASE_URL", "https://acme.supabase.co");
  vi.stubEnv("ACME_SUPABASE_ANON_KEY", "acme-anon");
  vi.stubEnv("ACME_SUPABASE_SERVICE_KEY", "acme-service");
  const { clearInstanceCache } = await importRegistry();
  clearInstanceCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("lookupInstance", () => {
  it("builds the config from the env names the row's prefix points at", async () => {
    rowFound(ACME_ROW);
    const { lookupInstance } = await importRegistry();

    expect(await lookupInstance("acme")).toEqual({
      subdomain: "acme",
      displayName: "Acme Industries",
      supabaseUrl: "https://acme.supabase.co",
      supabaseAnonKey: "acme-anon",
      supabaseServiceKey: "acme-service",
      status: "active",
    });

    expect(mocks.from).toHaveBeenCalledWith("instances");
    expect(mocks.eq).toHaveBeenCalledWith("subdomain", "acme");
  });

  it("addresses the control plane through the CONTROL_PLANE_* variables", async () => {
    rowFound(ACME_ROW);
    const { lookupInstance } = await importRegistry();
    await lookupInstance("acme");

    // The client is a module-level singleton, so it may have been
    // built by an earlier test. Either way it must never have been
    // pointed at the app's own Supabase variables.
    for (const call of mocks.createClient.mock.calls) {
      expect(call[0]).toBe("https://control.supabase.co");
      expect(call[1]).toBe("control-service-key");
    }
  });

  it("returns a suspended instance rather than hiding it", async () => {
    // Suspension is the caller's decision. Returning null here would
    // be indistinguishable from an unknown subdomain.
    rowFound({ ...ACME_ROW, status: "suspended" });
    const { lookupInstance } = await importRegistry();

    expect((await lookupInstance("acme"))?.status).toBe("suspended");
  });

  it("returns null when the subdomain isn't registered", async () => {
    noRow();
    const { lookupInstance } = await importRegistry();

    expect(await lookupInstance("nobody")).toBeNull();
  });

  it("returns null and logs when the row's env vars are missing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    rowFound({ ...ACME_ROW, env_prefix: "GHOST" });
    const { lookupInstance } = await importRegistry();

    expect(await lookupInstance("acme")).toBeNull();

    // The log line is the whole diagnosis: which instance, which
    // prefix, which variables.
    const message = logged.mock.calls[0]?.[0] as string;
    expect(message).toContain("acme");
    expect(message).toContain("GHOST");
    expect(message).toContain("GHOST_SUPABASE_URL");
    expect(message).toContain("GHOST_SUPABASE_ANON_KEY");
    expect(message).toContain("GHOST_SUPABASE_SERVICE_KEY");
  });

  it("returns null and logs when only one env var is missing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // A half-configured instance is as unusable as an unconfigured
    // one, and much easier to miss.
    vi.stubEnv("ACME_SUPABASE_SERVICE_KEY", "");
    rowFound(ACME_ROW);
    const { lookupInstance } = await importRegistry();

    expect(await lookupInstance("acme")).toBeNull();
    expect(logged.mock.calls[0]?.[0]).toContain("ACME_SUPABASE_SERVICE_KEY");
  });

  it("returns null and logs when the control plane query errors", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });
    const { lookupInstance } = await importRegistry();

    expect(await lookupInstance("acme")).toBeNull();
    expect(logged.mock.calls[0]?.[0]).toContain("connection refused");
  });
});

describe("the lookup cache", () => {
  it("serves a second lookup from cache inside the TTL", async () => {
    rowFound(ACME_ROW);
    const { lookupInstance } = await importRegistry();

    const first = await lookupInstance("acme");
    const second = await lookupInstance("acme");

    expect(second).toEqual(first);
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has passed", async () => {
    vi.useFakeTimers();
    rowFound(ACME_ROW);
    const { lookupInstance } = await importRegistry();

    await lookupInstance("acme");
    vi.advanceTimersByTime(59_000);
    await lookupInstance("acme");
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    await lookupInstance("acme");
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2);
  });

  it("caches per subdomain rather than globally", async () => {
    rowFound(ACME_ROW);
    const { lookupInstance } = await importRegistry();

    await lookupInstance("acme");
    await lookupInstance("other");

    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2);
  });

  it("caches a miss, so an unknown subdomain can't hammer the control plane", async () => {
    noRow();
    const { lookupInstance } = await importRegistry();

    expect(await lookupInstance("nobody")).toBeNull();
    expect(await lookupInstance("nobody")).toBeNull();
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("caches only the resolved value, not the whole registry", async () => {
    // Two instances resolve independently; one being cached must not
    // make the other resolve to it.
    rowFound(ACME_ROW);
    const { lookupInstance } = await importRegistry();
    await lookupInstance("acme");

    vi.stubEnv("BETA_SUPABASE_URL", "https://beta.supabase.co");
    vi.stubEnv("BETA_SUPABASE_ANON_KEY", "beta-anon");
    vi.stubEnv("BETA_SUPABASE_SERVICE_KEY", "beta-service");
    rowFound({
      subdomain: "beta",
      display_name: "Beta Co",
      env_prefix: "BETA",
      status: "active",
    });

    expect((await lookupInstance("beta"))?.supabaseUrl).toBe(
      "https://beta.supabase.co",
    );
    expect((await lookupInstance("acme"))?.supabaseUrl).toBe(
      "https://acme.supabase.co",
    );
  });
});
