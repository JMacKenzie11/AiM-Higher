import { describe, it, expect, vi } from "vitest";

import {
  PRIMARY_PASSWORD_VAR,
  isProblem,
  migrateAllInstances,
  pendingMigrations,
  refFromSupabaseUrl,
  resolveTarget,
  unbaselinedReason,
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
  shape?: { hasMigrationTable: boolean; publicTables: number };
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
        databaseShape: async () =>
          opts.shape ?? { hasMigrationTable: true, publicTables: 66 },
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
      databaseShape: async () => ({ hasMigrationTable: true, publicTables: 66 }),
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

    // It does shell out now — to verify it can connect — but only ever
    // with --dry-run, so nothing is applied. And only for the instance
    // that had pending work.
    expect(h.runCommand).toHaveBeenCalledTimes(1);
    for (const [, args] of h.runCommand.mock.calls) {
      expect(args).toContain("--dry-run");
    }
  });

  it("dry-run blocks an instance it cannot connect to, instead of promising a plan", async () => {
    // The gap this closes: reading the migrations table through the
    // Management API says "would apply 1" for a database whose
    // password is wrong. That is a claim reported as a fact — the same
    // mistake as trusting an exit code over the table.
    const h = harness({
      rows: [ROW("acme", "ACME")],
      applied: { acmeref: ["0001"] },
      failOn: "acmeref",
      dryRun: true,
    });
    const results = await h.run();

    expect(results[0].status).toBe("blocked");
    if (results[0].status === "blocked") {
      expect(results[0].reason).toContain("cannot connect");
      expect(results[0].reason).toContain("would apply 2");
      expect(results[0].reason).not.toContain("postgresql://");
    }
  });

  it("dry-run does not connect to an instance with nothing pending", async () => {
    // Nothing to honour, so nothing to verify. Opening a connection
    // per instance per run to learn nothing is the cost this avoids.
    const h = harness({
      rows: [ROW("acme", "ACME")],
      applied: { acmeref: ["0001", "0002", "0169"] },
      dryRun: true,
    });
    const results = await h.run();

    expect(results[0].status).toBe("up-to-date");
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

describe("migrateAllInstances: one database, one migration", () => {
  it("migrates a shared database once and names the other rows", async () => {
    // "@" and "www" both point at the primary. env_prefix names the
    // database; the subdomain does not. Without deduplication the same
    // database is pushed twice in one run — the second is a no-op, but
    // the run reports two instances where there is one, and a single
    // cause produces two failure lines.
    const h = harness({
      rows: [ROW("@", "PROD"), ROW("www", "PROD")],
      applied: { prodref: ["0001"] },
    });
    const results = await h.run();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      subdomain: "@",
      envPrefix: "PROD",
      status: "applied",
      aliases: ["www"],
    });
    // The push happened once, not twice.
    expect(h.runCommand).toHaveBeenCalledTimes(1);
  });

  it("keeps distinct databases separate", async () => {
    const h = harness({
      rows: [ROW("acme", "ACME"), ROW("beta", "BETA")],
      applied: { acmeref: [], betaref: [] },
    });
    const results = await h.run();

    expect(results).toHaveLength(2);
    expect(results.every((r) => (r.aliases ?? []).length === 0)).toBe(true);
    expect(h.runCommand).toHaveBeenCalledTimes(2);
  });

  it("reports one failure for one database, not one per row", async () => {
    const h = harness({
      rows: [ROW("@", "PROD"), ROW("www", "PROD")],
      applied: { prodref: [] },
      failOn: "prodref",
    });
    const results = await h.run();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "failed", aliases: ["www"] });
  });

  it("deduplicates a blocked database too", async () => {
    // Otherwise one missing password produces two BLOCKED lines and
    // the count in "N of M need attention" is wrong.
    const h = harness({
      rows: [ROW("@", "PROD"), ROW("www", "PROD")],
      env: { PROD_SUPABASE_URL: ENV.PROD_SUPABASE_URL },
      state: {},
    });
    const results = await h.run();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "blocked", aliases: ["www"] });
  });
});

describe("un-baselined databases", () => {
  it("blocks a database that has the schema but no migration history", async () => {
    // The dangerous case, and the one production is actually in: no
    // history means every migration reads as pending, so a push would
    // replay all of them over live data. 20 of ours create tables
    // without IF NOT EXISTS and 44 contain drops.
    const h = harness({
      rows: [ROW("@", "PROD")],
      shape: { hasMigrationTable: false, publicTables: 66 },
    });
    const results = await h.run();

    expect(results[0].status).toBe("blocked");
    if (results[0].status === "blocked") {
      expect(results[0].reason).toContain("no migration history");
      expect(results[0].reason).toContain("migration repair");
    }
    expect(h.runCommand).not.toHaveBeenCalled();
  });

  it("allows a genuinely empty database through", async () => {
    // A brand-new project also has no migration table. It has no
    // tables either, so there is nothing to replay over.
    const h = harness({
      rows: [ROW("acme", "ACME")],
      shape: { hasMigrationTable: false, publicTables: 0 },
      applied: { acmeref: [] },
    });
    const results = await h.run();

    expect(results[0].status).toBe("applied");
    expect(h.runCommand).toHaveBeenCalledTimes(1);
  });

  it("blocks in dry-run too, rather than reporting a reassuring plan", async () => {
    // A dry run saying "would apply 90" reads as a plan. It is a
    // warning, and it must not look like the former.
    const h = harness({
      rows: [ROW("@", "PROD")],
      shape: { hasMigrationTable: false, publicTables: 66 },
      dryRun: true,
    });
    const results = await h.run();
    expect(results[0].status).toBe("blocked");
  });
});

describe("unbaselinedReason", () => {
  it("is silent when history exists", () => {
    expect(
      unbaselinedReason({ hasMigrationTable: true, publicTables: 66 }, "x")
    ).toBeNull();
  });

  it("is silent for an empty database", () => {
    expect(
      unbaselinedReason({ hasMigrationTable: false, publicTables: 0 }, "x")
    ).toBeNull();
  });

  it("fires for schema without history", () => {
    expect(
      unbaselinedReason({ hasMigrationTable: false, publicTables: 1 }, "x")
    ).toContain("no migration history");
  });
});

