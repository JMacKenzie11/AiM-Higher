import { describe, it, expect, vi } from "vitest";

import {
  PROVISION_STEPS,
  type ProvisionContext,
  type ProvisionDeps,
} from "./plan.ts";
import { HEALTHY_STATUS, type ManagementProject } from "./supabase-management.ts";
import type { InstanceState } from "./state.ts";

// create-supabase-project, driven end to end with a fake API, a fake
// clock and a fake disk.
//
// The property that matters most is idempotency. Creating a second
// project for one subdomain leaves an orphan that nobody is watching
// and nothing points at, still costing money — and a rerun after a
// failed step is the normal case, not the exception.

const STEP = PROVISION_STEPS.find((s) => s.name === "create-supabase-project")!;

const CTX: ProvisionContext = {
  subdomain: "provtest1",
  envPrefix: "PROVTEST1",
  displayName: "Prov Test 1",
  adminEmail: "admin@provtest1.example",
  region: "us-east-1",
  dryRun: false,
};

const KEYS = [
  { name: "anon", api_key: "sb_publishable_fake" },
  { name: "service_role", api_key: "sb_secret_fake" },
];

function makeDeps(opts: {
  existing?: ManagementProject[];
  statusSequence?: string[];
  keys?: Array<{ name: string; api_key: string }>;
}) {
  const state: Record<string, InstanceState> = {};
  let now = 0;
  const statuses = [...(opts.statusSequence ?? [])];

  const createProject = vi.fn(
    async (input: { name: string; region: string }): Promise<ManagementProject> => ({
      id: "newref123",
      name: input.name,
      region: input.region,
      status: "COMING_UP",
    })
  );
  const getProject = vi.fn(async (ref: string): Promise<ManagementProject | null> => ({
    id: ref,
    name: "aims-higher-provtest1",
    region: "us-east-1",
    status: statuses.shift() ?? HEALTHY_STATUS,
  }));
  const getApiKeys = vi.fn(async () => opts.keys ?? KEYS);
  const listProjects = vi.fn(async () => opts.existing ?? []);

  const deps: ProvisionDeps = {
    management: {
      listOrganizations: vi.fn(async () => [{ id: "org1", name: "AiMS" }]),
      listProjects,
      getProject,
      createProject,
      getApiKeys,
      getPoolerConfig: vi.fn(async () => [
        { db_host: "aws-0-us-east-1.pooler.supabase.com", db_port: 6543, db_user: "postgres.x", db_name: "postgres" },
      ]),
      runQuery: vi.fn(async () => []),
    },
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
        runCommand: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
    localMigrations: () => [],
    readSeedSql: () => "",
    readState: (subdomain) => state[subdomain] ?? null,
    writeState: (subdomain, patch) => {
      state[subdomain] = { ...(state[subdomain] ?? { subdomain }), ...patch };
      return state[subdomain];
    },
    log: vi.fn(),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };

  return { deps, state, createProject, getProject, getApiKeys, listProjects };
}

describe("create-supabase-project: idempotency", () => {
  it("adopts an existing healthy project instead of creating a second one", async () => {
    const { deps, createProject, state } = makeDeps({
      existing: [
        {
          id: "existing1",
          name: "aims-higher-provtest1",
          region: "us-east-1",
          status: HEALTHY_STATUS,
        },
      ],
    });

    const result = await STEP.execute(CTX, deps);

    expect(result.status).toBe("skipped");
    expect(result.detail).toMatch(/already exists/);
    expect(result.detail).toContain("existing1");
    expect(createProject).not.toHaveBeenCalled();
    // It still records the details, so a rerun that adopts is as
    // useful to later steps as the run that created.
    expect(state.provtest1.projectRef).toBe("existing1");
    expect(state.provtest1.apiUrl).toBe("https://existing1.supabase.co");
  });

  it("matches on the naming convention, not on anything looser", async () => {
    // Another instance's project, and a project whose name merely
    // contains ours, must not be adopted.
    const { deps, createProject } = makeDeps({
      existing: [
        { id: "other", name: "aims-higher-provtest2", region: "us-east-1", status: HEALTHY_STATUS },
        { id: "prefix", name: "aims-higher-provtest10", region: "us-east-1", status: HEALTHY_STATUS },
        { id: "suffix", name: "old-aims-higher-provtest1", region: "us-east-1", status: HEALTHY_STATUS },
      ],
    });

    const result = await STEP.execute(CTX, deps);

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("done");
  });

  it("resumes waiting on an existing project that is still coming up", async () => {
    // The interrupted-run case: the project exists but was not healthy
    // when the last run died. Adopt it and keep waiting.
    const { deps, createProject, getProject } = makeDeps({
      existing: [
        { id: "coming1", name: "aims-higher-provtest1", region: "us-east-1", status: "COMING_UP" },
      ],
      statusSequence: ["COMING_UP", HEALTHY_STATUS],
    });

    const result = await STEP.execute(CTX, deps);

    expect(createProject).not.toHaveBeenCalled();
    expect(getProject).toHaveBeenCalled();
    expect(result.status).toBe("skipped");
  });
});

describe("create-supabase-project: creation", () => {
  it("creates, waits, and records everything downstream needs", async () => {
    const { deps, createProject, state } = makeDeps({
      statusSequence: ["COMING_UP", "COMING_UP", HEALTHY_STATUS],
    });

    const result = await STEP.execute(CTX, deps);

    expect(result.status).toBe("done");
    expect(createProject).toHaveBeenCalledWith({
      name: "aims-higher-provtest1",
      organizationId: "org1",
      region: "us-east-1",
      dbPass: expect.any(String),
    });

    const saved = state.provtest1;
    expect(saved.projectRef).toBe("newref123");
    expect(saved.apiUrl).toBe("https://newref123.supabase.co");
    expect(saved.anonKey).toBe("sb_publishable_fake");
    expect(saved.serviceKey).toBe("sb_secret_fake");
    expect(saved.dbPassword).toBeTruthy();
  });

  it("writes the password BEFORE creating the project", async () => {
    // The Management API never returns it again. If it were written
    // after a create that then failed mid-flight, the project could
    // exist with a password nobody holds — unrecoverable.
    const order: string[] = [];
    const { deps } = makeDeps({});
    const originalWrite = deps.writeState;
    deps.writeState = (subdomain, patch) => {
      if (patch.dbPassword) order.push("wrote-password");
      return originalWrite(subdomain, patch);
    };
    deps.management.createProject = vi.fn(async () => {
      order.push("created-project");
      return {
        id: "newref123",
        name: "aims-higher-provtest1",
        region: "us-east-1",
        status: HEALTHY_STATUS,
      };
    });

    await STEP.execute(CTX, deps);

    expect(order).toEqual(["wrote-password", "created-project"]);
  });

  it("prints the password once, since it can never be retrieved", async () => {
    const { deps } = makeDeps({});
    await STEP.execute(CTX, deps);

    const lines = (deps.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string
    );
    expect(lines.some((l) => l.includes("shown once"))).toBe(true);
    expect(lines.some((l) => l.includes(".provisioning-state/provtest1.json"))).toBe(
      true
    );
  });

  it("fails loudly when the project is healthy but returns no usable keys", async () => {
    // Healthy and unusable is the worst outcome to pass on silently:
    // every later step would fail with something less specific.
    const { deps } = makeDeps({ keys: [{ name: "anon", api_key: "sb_publishable_fake" }] });

    await expect(STEP.execute(CTX, deps)).rejects.toThrow(/service key|both an anon/i);
  });

  it("explains that a rerun resumes when the project never comes up", async () => {
    const { deps } = makeDeps({
      statusSequence: Array.from({ length: 200 }, () => "COMING_UP"),
    });

    await expect(STEP.execute(CTX, deps)).rejects.toThrow(/[Rr]erunning/);
    await expect(
      STEP.execute(CTX, { ...deps, readState: () => null })
    ).rejects.toThrow(/left in place/);
  });
});
