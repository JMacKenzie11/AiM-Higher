import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCurrentInstanceConfig } from "./current";
import { runWithInstance } from "./context";
import { INSTANCE_HEADER, serializeInstance } from "./request";
import type { InstanceConfig } from "./types";

// getCurrentInstanceConfig has two jobs: read what middleware
// attached, and refuse to invent an answer when nothing did.

const headerStore = { value: null as string | null };

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === INSTANCE_HEADER ? headerStore.value : null,
  }),
}));

const ACME: InstanceConfig = {
  subdomain: "acme",
  displayName: "Acme Industries",
  supabaseUrl: "https://acme.supabase.co",
  supabaseAnonKey: "acme-anon",
  supabaseServiceKey: "acme-service",
  status: "active",
};

const ALL_VARS = [
  "PROD_SUPABASE_URL",
  "PROD_SUPABASE_ANON_KEY",
  "PROD_SUPABASE_SERVICE_KEY",
  "LOCAL_INSTANCE_SUPABASE_URL",
  "LOCAL_INSTANCE_SUPABASE_ANON_KEY",
  "LOCAL_INSTANCE_SUPABASE_SERVICE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  headerStore.value = null;
  saved = {};
  for (const name of ALL_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of ALL_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("getCurrentInstanceConfig", () => {
  it("returns what middleware attached to the request", async () => {
    headerStore.value = serializeInstance(ACME);
    // No env variables are set at all, so this can only have come
    // from the header.
    await expect(getCurrentInstanceConfig()).resolves.toEqual(ACME);
  });

  it("prefers the header over the fallback", async () => {
    headerStore.value = serializeInstance(ACME);
    process.env.PROD_SUPABASE_URL = "https://prod.supabase.co";
    process.env.PROD_SUPABASE_ANON_KEY = "prod-anon";
    process.env.PROD_SUPABASE_SERVICE_KEY = "prod-service";

    const config = await getCurrentInstanceConfig();
    expect(config.supabaseUrl).toBe("https://acme.supabase.co");
  });

  it("falls back to PROD_* when nothing was attached", async () => {
    // The cron case: excluded from middleware, so it names its
    // database rather than inferring one.
    process.env.PROD_SUPABASE_URL = "https://prod.supabase.co";
    process.env.PROD_SUPABASE_ANON_KEY = "prod-anon";
    process.env.PROD_SUPABASE_SERVICE_KEY = "prod-service";

    await expect(getCurrentInstanceConfig()).resolves.toEqual({
      subdomain: "prod",
      displayName: "Production",
      supabaseUrl: "https://prod.supabase.co",
      supabaseAnonKey: "prod-anon",
      supabaseServiceKey: "prod-service",
      status: "active",
    });
  });

  it("falls back to the developer override when PROD_* is absent", async () => {
    // So a cron route can be exercised locally without setting
    // PROD_* and aiming it at the live database by accident.
    process.env.LOCAL_INSTANCE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.LOCAL_INSTANCE_SUPABASE_ANON_KEY = "local-anon";
    process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY = "local-service";

    const config = await getCurrentInstanceConfig();
    expect(config.subdomain).toBe("local");
    expect(config.supabaseUrl).toBe("http://127.0.0.1:54321");
  });

  it("prefers PROD_* over the developer override", async () => {
    process.env.PROD_SUPABASE_URL = "https://prod.supabase.co";
    process.env.PROD_SUPABASE_ANON_KEY = "prod-anon";
    process.env.PROD_SUPABASE_SERVICE_KEY = "prod-service";
    process.env.LOCAL_INSTANCE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.LOCAL_INSTANCE_SUPABASE_ANON_KEY = "local-anon";
    process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY = "local-service";

    const config = await getCurrentInstanceConfig();
    expect(config.subdomain).toBe("prod");
  });

  it("throws, naming both variable sets, when nothing says which database", async () => {
    await expect(getCurrentInstanceConfig()).rejects.toThrow(
      /PROD_SUPABASE_URL.*or.*LOCAL_INSTANCE_SUPABASE_URL/s,
    );
  });

  it("throws rather than using a half-set of variables", async () => {
    process.env.PROD_SUPABASE_URL = "https://prod.supabase.co";
    process.env.PROD_SUPABASE_ANON_KEY = "prod-anon";
    // service key missing

    await expect(getCurrentInstanceConfig()).rejects.toThrow(
      /Refusing to guess a database/,
    );
  });

  it("no longer falls back to the legacy NEXT_PUBLIC_ variables", async () => {
    // This is the regression this change exists to prevent: a
    // misconfigured cron used to run successfully against whichever
    // database these named.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://legacy.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy-service";

    await expect(getCurrentInstanceConfig()).rejects.toThrow(
      /Refusing to guess a database/,
    );
  });

  it("throws rather than trusting a malformed header", async () => {
    headerStore.value = "{ not a config }";

    await expect(getCurrentInstanceConfig()).rejects.toThrow(
      /Refusing to guess a database/,
    );
  });
});

describe("the fan-out scope", () => {
  // This is the mechanism the cron fan-out rests on. The transcript
  // pipeline builds its own admin clients from
  // getCurrentInstanceConfig() in nine places, and none of them were
  // rewritten to take a client argument. They land on the right
  // database only because the scope answers here.
  const BETA: InstanceConfig = {
    subdomain: "beta",
    displayName: "Beta Co",
    supabaseUrl: "https://beta.supabase.co",
    supabaseAnonKey: "beta-anon",
    supabaseServiceKey: "beta-service",
    status: "active",
  };

  it("answers for work running inside it", async () => {
    const config = await runWithInstance(BETA, async () => {
      // An await in between, because the real callers are several
      // deep in a pipeline rather than synchronous.
      await Promise.resolve();
      return getCurrentInstanceConfig();
    });
    expect(config).toEqual(BETA);
  });

  it("wins over an attached header", async () => {
    // Cannot happen today: middleware excludes the cron routes from
    // resolution, so a fanned-out job never carries a header. Pinned
    // anyway, because the explicit scope is the more specific
    // statement of which database this work is for, and a future
    // caller that has both should not silently get the other one.
    headerStore.value = serializeInstance(ACME);
    const config = await runWithInstance(BETA, () =>
      getCurrentInstanceConfig(),
    );
    expect(config.subdomain).toBe("beta");
  });

  it("does not leak outside itself", async () => {
    headerStore.value = serializeInstance(ACME);
    await runWithInstance(BETA, async () => getCurrentInstanceConfig());
    expect((await getCurrentInstanceConfig()).subdomain).toBe("acme");
  });

  it("still throws for a cron route that opened no scope", async () => {
    // The protection that made the fallback strict in the first
    // place has to survive the fan-out: no scope and no header and
    // no variables is still a refusal, not a guess.
    headerStore.value = null;
    await expect(getCurrentInstanceConfig()).rejects.toThrow(
      /Refusing to guess a database/,
    );
  });
});
