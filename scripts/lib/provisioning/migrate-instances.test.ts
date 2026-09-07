import { describe, it, expect, vi } from "vitest";

import {
  PRIMARY_PASSWORD_VAR,
  isProblem,
  migrateAllInstances,
  pendingMigrations,
  refFromSupabaseUrl,
  resolveTarget,
  type RegistryRow,
} from "./migrate.ts";
import type { InstanceState } from "./state.ts";

const LOCAL = ["0001_a.sql", "0002_b.sql", "0169_z.sql"];

const ROW = (subdomain: string, envPrefix: string): RegistryRow => ({
  subdomain,
  env_prefix: envPrefix,
  status: "active",
});

const ENV = {
  ACME_SUPABASE_URL: "https://acmeref.supabase.co",
  BETA_SUPABASE_URL: "https://betaref.supabase.co",
  PROD_SUPABASE_URL: "https://prodref.supabase.co",
  PROD_DATABASE_PASSWORD: "prod-pw",
};

const STATE: Record<string, InstanceState> = {
  acme: { subdomain: "acme", dbPassword: "acme-pw", projectRef: "acmeref" },
  beta: { subdomain: "beta", dbPassword: "beta-pw", projectRef: "betaref" },
};

function harness(opts: {
  rows: RegistryRow[];
  applied?: Record<string, string[]>;
  failOn?: string;
  state?: Record<string, InstanceState>;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
}) {
  const lines: string[] = [];
  // Tracks how many times each ref was read, so a dry run can be shown
  // to have consulted without pushing.
  const runCommand = vi.fn(async (_c: string, args: string[]) => {
    const url = args.find((a) => a.startsWith("postgresql://")) ?? "";
    if (opts.failOn && url.includes(opts.failOn)) {
      return { code: 1, stdout: "", stderr: "connection refused" };
    }
    return { code: 0, stdout: "Finished supabase db push.", stderr: "" };
  });

  const appliedByRef: Record<string, string[]> = { ...(opts.applied ?? {}) };
  const appliedVersionsFor = vi.fn(async (ref: string) => {
    const current = appliedByRef[ref] ?? [];
    return new Set(current);
  });
  // After a successful push, the remote table catches up.
  const pushThenCatchUp = vi.fn(async (c: string, args: string[]) => {
    const result = await runCommand(c, args);
    if (result.code === 0) {
      const url = args.find((a) => a.startsWith("postgresql://")) ?? "";
      const ref = url.match(/postgres\.([a-z0-9]+):/)?.[1];
      if (ref) appliedByRef[ref] = LOCAL.map((f) => f.split("_")[0]);
    }
    return result;
  });

  return {
    lines,
    runCommand: pushThenCatchUp,
    appliedVersionsFor,
    run: () =>
      migrateAllInstances({
        rows: opts.rows,
        env: opts.env ?? ENV,
        readState: (s) => (opts.state ?? STATE)[s] ?? null,
        localMigrations: LOCAL,
        dryRun: opts.dryRun,
        poolerHostFor: async () => "aws-0-us-east-1.pooler.supabase.com",
        appliedVersionsFor,
        runCommand: pushThenCatchUp,
        log: (l) => lines.push(l),
      }),
  };
}

describe("pendingMigrations", () => {
  it("is everything local the remote has not applied", () => {
    expect(pendingMigrations(LOCAL, new Set(["0001"]))).toEqual([
      "0002_b.sql",
      "0169_z.sql",
    ]);
    expect(pendingMigrations(LOCAL, new Set(["0001", "0002", "0169"]))).toEqual([]);
  });

  it("treats an empty remote table as nothing applied", () => {
    expect(pendingMigrations(LOCAL, new Set())).toEqual(LOCAL);
  });
});

describe("refFromSupabaseUrl", () => {
  it("takes the ref from the project URL the registry points at", () => {
    expect(refFromSupabaseUrl("https://abcdef.supabase.co")).toBe("abcdef");
    expect(refFromSupabaseUrl("https://abcdef.supabase.co/rest/v1")).toBe("abcdef");
    expect(refFromSupabaseUrl("not-a-url")).toBeNull();
  });
});

describe("resolveTarget", () => {
  it("takes a provisioned instance's password from its state file", () => {
    const t = resolveTarget({ row: ROW("acme", "ACME"), env: ENV, readState: (s) => STATE[s] ?? null });
    expect(t).toMatchObject({ ok: true, ref: "acmeref", password: "acme-pw" });
  });

  it("blocks, rather than skipping, when the state file is missing", () => {
    // Silently skipping would leave an instance a release behind with
    // nothing saying so — the exact failure this tool exists to catch.
    const t = resolveTarget({ row: ROW("ghost", "GHOST"), env: ENV, readState: () => null });
    expect(t.ok).toBe(false);
    if (!t.ok) {
      expect(t.reason).toContain(".provisioning-state/ghost.json");
      expect(t.reason).toMatch(/cannot be recovered|by hand/);
    }
  });

  it("takes the primary instance's password from the environment", () => {
    // It has no state file: it was not created by provisioning.
    const t = resolveTarget({ row: ROW("@", "PROD"), env: ENV, readState: () => null });
    expect(t).toMatchObject({ ok: true, ref: "prodref", password: "prod-pw" });
  });

  it("blocks the primary instance by name when that variable is unset", () => {
    const t = resolveTarget({
      row: ROW("@", "PROD"),
      env: { PROD_SUPABASE_URL: ENV.PROD_SUPABASE_URL },
      readState: () => null,
    });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toContain(PRIMARY_PASSWORD_VAR);
  });

  it("does not require a local copy of an instance's Supabase URL", () => {
    // The registry's whole point is that {PREFIX}_SUPABASE_* live in
    // Vercel. A local copy would be a second source of truth that
    // drifts the first time one is rotated.
    const t = resolveTarget({
      row: ROW("acme", "ACME"),
      env: {},
      readState: (sub) => STATE[sub] ?? null,
    });
    expect(t).toMatchObject({ ok: true, ref: "acmeref" });
  });

  it("blocks the primary instance when its URL is absent", () => {
    const t = resolveTarget({
      row: ROW("@", "PROD"),
      env: { PROD_DATABASE_PASSWORD: "pw" },
      readState: () => null,
    });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toContain("PROD_SUPABASE_URL");
  });
});

describe("migrateAllInstances", () => {
  it("applies to every instance that is behind", async () => {
    const h = harness({ rows: [ROW("acme", "ACME"), ROW("beta", "BETA")], applied: { acmeref: ["0001"], betaref: [] } });
    const results = await h.run();

    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(h.runCommand).toHaveBeenCalledTimes(2);
  });

  it("reports up to date without shelling out", async () => {
    const h = harness({
      rows: [ROW("acme", "ACME")],
      applied: { acmeref: ["0001", "0002", "0169"] },
    });
    const results = await h.run();

    expect(results[0]).toMatchObject({ status: "up-to-date", version: "0169" });
    expect(h.runCommand).not.toHaveBeenCalled();
  });

  it("runs instances in sequence, not in parallel", async () => {
    // Interleaved output is unreadable at the moment it matters most:
    // immediately before a deploy, when knowing WHICH instance failed
    // is the whole point.
    const order: string[] = [];
    await migrateAllInstances({
      rows: [ROW("acme", "ACME"), ROW("beta", "BETA")],
      env: ENV,
      readState: (s) => STATE[s] ?? null,
      localMigrations: LOCAL,
      poolerHostFor: async () => "host",
      appliedVersionsFor: async (ref) => {
        order.push(`start:${ref}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end:${ref}`);
        return new Set(LOCAL.map((f) => f.split("_")[0]));
      },
      runCommand: vi.fn(),
      log: () => {},
    });

    expect(order).toEqual([
      "start:acmeref",
      "end:acmeref",
      "start:betaref",
      "end:betaref",
    ]);
  });

  it("blocks a missing state file and keeps going", async () => {
    const h = harness({
      rows: [ROW("ghost", "GHOST"), ROW("acme", "ACME")],
      applied: { acmeref: [] },
    });
    const results = await h.run();

    expect(results[0]).toMatchObject({ subdomain: "ghost", status: "blocked" });
    expect(results[1]).toMatchObject({ subdomain: "acme", status: "applied" });
    expect(results).toHaveLength(2);
  });

  it("keeps going after a failure, and reports every instance", async () => {
    // Stopping early leaves the rest in an unknown state, which is
    // worse than a known-bad one.
    const h = harness({
      rows: [ROW("acme", "ACME"), ROW("beta", "BETA")],
      applied: { acmeref: [], betaref: [] },
      failOn: "acmeref",
    });
    const results = await h.run();

    expect(results[0]).toMatchObject({ subdomain: "acme", status: "failed" });
    expect(results[0]).toHaveProperty("reason", expect.stringContaining("connection refused"));
    expect(results[1]).toMatchObject({ subdomain: "beta", status: "applied" });
  });

  it("never puts the connection string in a failure reason", async () => {
    // It carries the database password.
    const h = harness({
      rows: [ROW("acme", "ACME")],
      applied: { acmeref: [] },
      failOn: "acmeref",
    });
    const [result] = await h.run();
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).not.toContain("postgresql://");
      expect(result.reason).not.toContain("acme-pw");
    }
  });

  it("aggregates problems so the caller can exit nonzero", async () => {
    const h = harness({
      rows: [ROW("acme", "ACME"), ROW("ghost", "GHOST"), ROW("beta", "BETA")],
      applied: { acmeref: [], betaref: ["0001", "0002", "0169"] },
      failOn: "acmeref",
    });
    const results = await h.run();

    expect(results.filter(isProblem).map((r) => r.subdomain)).toEqual([
      "acme",
      "ghost",
    ]);
    expect(results.filter((r) => !isProblem(r))).toHaveLength(1);
  });

  it("dry-run reports what would happen and touches nothing", async () => {
    const h = harness({
      rows: [ROW("acme", "ACME"), ROW("beta", "BETA")],
      applied: { acmeref: ["0001"], betaref: ["0001", "0002", "0169"] },
      dryRun: true,
    });
    const results = await h.run();

    expect(results[0]).toMatchObject({ status: "would-apply", version: "0169" });
    expect(results[0]).toHaveProperty("pending", ["0002_b.sql", "0169_z.sql"]);
    expect(results[1]).toMatchObject({ status: "up-to-date" });
    // The only thing that writes.
    expect(h.runCommand).not.toHaveBeenCalled();
  });

  it("dry-run still blocks a missing state file", async () => {
    // Otherwise a dry run would report all clear for an instance that
    // cannot actually be migrated.
    const h = harness({
      rows: [ROW("ghost", "GHOST")],
      dryRun: true,
    });
    const results = await h.run();
    expect(results[0].status).toBe("blocked");
  });
});
