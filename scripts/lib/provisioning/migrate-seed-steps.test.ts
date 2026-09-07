import { describe, it, expect, vi } from "vitest";

import {
  PROVISION_STEPS,
  migrationVersion,
  type ProvisionContext,
  type ProvisionDeps,
} from "./plan.ts";
import {
  SESSION_POOLER_PORT,
  migrationConnectionUrl,
} from "./supabase-management.ts";
import type { InstanceState } from "./state.ts";

const MIGRATE = PROVISION_STEPS.find((s) => s.name === "apply-migrations")!;
const SEED = PROVISION_STEPS.find((s) => s.name === "seed-data")!;

const CTX: ProvisionContext = {
  subdomain: "provtest1",
  envPrefix: "PROVTEST1",
  displayName: "Prov Test 1",
  adminEmail: "a@b.co",
  region: "us-east-1",
  dryRun: false,
};

const LOCAL = ["0001_helpers.sql", "0002_identity.sql", "0169_instances.sql"];

function makeDeps(opts: {
  state?: Partial<InstanceState> | null;
  appliedVersions?: string[];
  commandCode?: number;
  commandOutput?: string;
  seedSql?: string;
  // Versions reported by the SECOND query, after the push.
  appliedAfter?: string[];
}) {
  const stored: Record<string, InstanceState> =
    opts.state === null
      ? {}
      : {
          provtest1: {
            subdomain: "provtest1",
            projectRef: "ref123",
            dbPassword: "pw-with/slash",
            ...opts.state,
          },
        };

  let queryCall = 0;
  const runQuery = vi.fn(async (_ref: string, sql: string) => {
    if (sql.includes("schema_migrations")) {
      queryCall += 1;
      const versions =
        queryCall === 1
          ? (opts.appliedVersions ?? [])
          : (opts.appliedAfter ?? opts.appliedVersions ?? []);
      return versions.map((v) => ({ version: v }));
    }
    if (sql.includes("count(*)")) {
      return [{ strengths_items: 38, classroom_categories: 1 }];
    }
    return [];
  });

  // Typed params so the assertions below can read the command and its
  // arguments back off mock.calls.
  const runCommand = vi.fn(async (command: string, args: string[]) => {
    void command;
    void args;
    return {
      code: opts.commandCode ?? 0,
      stdout: opts.commandOutput ?? "Finished supabase db push.",
      stderr: "",
    };
  });

  const deps: ProvisionDeps = {
    management: {
      listOrganizations: vi.fn(async () => []),
      listProjects: vi.fn(async () => []),
      getProject: vi.fn(async () => null),
      createProject: vi.fn(),
      getApiKeys: vi.fn(async () => []),
      getPoolerConfig: vi.fn(async () => [
        {
          db_host: "aws-0-us-east-1.pooler.supabase.com",
          db_port: 6543,
          db_user: "postgres.ref123",
          db_name: "postgres",
        },
      ]),
      runQuery: runQuery as ProvisionDeps["management"]["runQuery"],
    } as unknown as ProvisionDeps["management"],
    organizationId: "org1",
    vercel: {
      getProject: vi.fn(async () => ({ id: "prj", name: "aims-higher" })),
      listEnv: vi.fn(async () => []),
      createEnv: vi.fn(async () => ({})),
      updateEnv: vi.fn(async () => ({})),
      latestProductionDeployment: vi.fn(async () => null),
      redeploy: vi.fn(async () => ({ uid: "dpl_new" })),
      getDeployment: vi.fn(async () => ({ readyState: "READY" })),
    },
    httpGet: vi.fn(async () => ({ status: 200, body: "" })),
    getRegistryRow: vi.fn(async () => null),
    upsertRegistryRow: vi.fn(async () => {}),
    instanceAdminClient: vi.fn(() => ({}) as never),
    sendInvite: vi.fn(async () => ({ ok: false, message: "not configured" })),
        readState: (s) => stored[s] ?? null,
    writeState: (s, patch) => {
      stored[s] = { ...(stored[s] ?? { subdomain: s }), ...patch };
      return stored[s];
    },
    runCommand,
    localMigrations: () => LOCAL,
    recordFleetCredentials: () => ({ added: [], alreadyPresent: [] }),
    readSeedSql: () => opts.seedSql ?? "insert into public.x values (1);",
    log: vi.fn(),
    now: () => 0,
    sleep: async () => {},
  };

  return { deps, stored, runCommand, runQuery };
}

describe("migrationVersion", () => {
  it("is the numeric prefix db push records", () => {
    expect(migrationVersion("0169_instances.sql")).toBe("0169");
    expect(migrationVersion("0001_helpers.sql")).toBe("0001");
  });
});

describe("migrationConnectionUrl", () => {
  it("uses the session pooler port, not transaction pooling", () => {
    // The pooler advertises 6543 / transaction mode, which cannot run
    // the statements migrations need. 5432 is session mode.
    expect(SESSION_POOLER_PORT).toBe(5432);
    expect(
      migrationConnectionUrl({
        poolerHost: "aws-0-us-east-1.pooler.supabase.com",
        ref: "ref123",
        password: "pw",
      })
    ).toBe(
      "postgresql://postgres.ref123:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
    );
  });

  it("percent-encodes the password, as the CLI requires", () => {
    const url = migrationConnectionUrl({
      poolerHost: "h",
      ref: "r",
      password: "a/b@c:d?e",
    });
    expect(url).toContain("a%2Fb%40c%3Ad%3Fe");
    expect(url).not.toContain("a/b@c");
  });
});

describe("apply-migrations", () => {
  it("skips when the remote already has every local migration", async () => {
    const { deps, runCommand } = makeDeps({
      appliedVersions: ["0001", "0002", "0169"],
    });

    const result = await MIGRATE.execute(CTX, deps);

    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("0169");
    // The point of comparing first: a no-op rerun should not shell out
    // to the CLI to be told nothing happened.
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("pushes when migrations are pending, and records the version", async () => {
    const { deps, runCommand, stored } = makeDeps({
      appliedVersions: ["0001"],
      appliedAfter: ["0001", "0002", "0169"],
    });

    const result = await MIGRATE.execute(CTX, deps);

    expect(result.status).toBe("done");
    expect(result.detail).toContain("applied 2");
    expect(stored.provtest1.migrationVersion).toBe("0169");

    const [command, args] = runCommand.mock.calls[0];
    expect(command).toBe("supabase");
    expect(args.slice(0, 2)).toEqual(["db", "push"]);
    expect(args).toContain("--include-all");
  });

  it("connects through the pooler, not the direct host", async () => {
    // db.{ref}.supabase.co is IPv6-only on a new project and simply
    // refuses the connection from an IPv4 machine.
    const { deps, runCommand } = makeDeps({
      appliedVersions: [],
      appliedAfter: ["0001", "0002", "0169"],
    });
    await MIGRATE.execute(CTX, deps);

    const url = runCommand.mock.calls[0][1].find((a) => a.startsWith("postgresql://"))!;
    expect(url).toContain("pooler.supabase.com");
    expect(url).not.toContain("db.ref123.supabase.co");
    expect(url).toContain(":5432/");
  });

  it("treats a missing migrations table as nothing applied", async () => {
    // It does not exist until the first push. That is not a failure.
    const { deps } = makeDeps({ appliedVersions: [] });
    let first = true;
    const failing = {
      ...deps,
      management: {
        ...deps.management,
        runQuery: vi.fn(async (_ref: string, sql: string) => {
          if (sql.includes("schema_migrations")) {
            // Absent before the first push, present after it.
            if (first) {
              first = false;
              throw new Error("relation does not exist");
            }
            return LOCAL.map((f) => ({ version: migrationVersion(f) }));
          }
          return [{ strengths_items: 0, classroom_categories: 0 }];
        }),
      },
    } as ProvisionDeps;

    const result = await MIGRATE.execute(CTX, failing);
    expect(result.status).toBe("done");
  });

  it("fails with the CLI's own output when the push fails", async () => {
    const { deps } = makeDeps({
      appliedVersions: [],
      commandCode: 1,
      commandOutput: "LegacyDbConnectError: dial error",
    });

    await expect(MIGRATE.execute(CTX, deps)).rejects.toThrow(/dial error/);
  });

  it("never puts the connection string in an error", async () => {
    // It carries the database password.
    const { deps } = makeDeps({
      appliedVersions: [],
      commandCode: 1,
      commandOutput: "boom",
    });

    await expect(MIGRATE.execute(CTX, deps)).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("postgresql://"),
      })
    );
  });

  it("refuses to believe a push that left migrations missing", async () => {
    // Exit code 0 is the CLI's claim; the remote table is the fact.
    const { deps } = makeDeps({
      appliedVersions: [],
      appliedAfter: ["0001"],
    });

    await expect(MIGRATE.execute(CTX, deps)).rejects.toThrow(
      /still missing remotely/
    );
  });

  it("refuses to run before the project exists", async () => {
    const { deps } = makeDeps({ state: null });
    await expect(MIGRATE.execute(CTX, deps)).rejects.toThrow(
      /create-supabase-project first/
    );
  });

  it("refuses when the project reports no pooler host", async () => {
    const { deps } = makeDeps({ appliedVersions: [] });
    const noPooler = {
      ...deps,
      management: { ...deps.management, getPoolerConfig: vi.fn(async () => []) },
    } as ProvisionDeps;

    await expect(MIGRATE.execute(CTX, noPooler)).rejects.toThrow(/no pooler host/);
  });
});

describe("seed-data", () => {
  it("runs the seed and reports what landed", async () => {
    const { deps, runQuery, stored } = makeDeps({});

    const result = await SEED.execute(CTX, deps);

    expect(result.status).toBe("done");
    expect(result.detail).toContain("38 strengths items");
    expect(result.detail).toContain("1 classroom categories");
    expect(runQuery.mock.calls[0][1]).toContain("insert into public.x");
    expect(stored.provtest1.seededAt).toBeTruthy();
  });

  it("refuses rather than reporting success on an empty seed file", async () => {
    // "Seeded" with nothing would leave an instance missing its
    // reference data and nothing would say so.
    for (const seedSql of ["", "   \n  "]) {
      const { deps } = makeDeps({ seedSql });
      await expect(SEED.execute(CTX, deps)).rejects.toThrow(/empty or missing/);
    }
  });

  it("refuses to run before the project exists", async () => {
    const { deps } = makeDeps({ state: null });
    await expect(SEED.execute(CTX, deps)).rejects.toThrow(
      /create-supabase-project first/
    );
  });

  it("is safe to run twice — the SQL carries the idempotency", async () => {
    // The file's inserts are ON CONFLICT DO UPDATE, so the step itself
    // has no skip logic and reruns are how reference data reaches
    // instances that already exist.
    const { deps, runQuery } = makeDeps({});
    await SEED.execute(CTX, deps);
    await SEED.execute(CTX, deps);
    const seedRuns = runQuery.mock.calls.filter((c) =>
      String(c[1]).includes("insert into public.x")
    );
    expect(seedRuns).toHaveLength(2);
  });
});
