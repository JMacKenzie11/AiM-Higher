import { describe, it, expect, vi } from "vitest";

import {
  PROVISION_STEPS,
  type ProvisionContext,
  type ProvisionDeps,
} from "./plan.ts";
import { fingerprint, type InstanceState } from "./state.ts";
import {
  DeploymentFailedError,
  DeploymentTimeoutError,
  planEnvVar,
  waitForDeployment,
  type VercelEnvVar,
} from "./vercel.ts";

const WRITE_ENV = PROVISION_STEPS.find((s) => s.name === "write-vercel-env")!;
const REDEPLOY = PROVISION_STEPS.find((s) => s.name === "trigger-redeploy")!;
const VERIFY = PROVISION_STEPS.find((s) => s.name === "verify-instance")!;

const CTX: ProvisionContext = {
  subdomain: "provtest1",
  envPrefix: "PROVTEST1",
  displayName: "Prov Test 1",
  adminEmail: "a@b.co",
  region: "us-east-1",
  dryRun: false,
};

const URL_VALUE = "https://ref123.supabase.co";
const ANON_VALUE = "sb_publishable_abc";
const SERVICE_VALUE = "sb_secret_xyz";

function envVar(key: string, value: string | undefined, type: string): VercelEnvVar {
  return {
    id: `env_${key}`,
    key,
    ...(value === undefined ? {} : { value }),
    type: type as VercelEnvVar["type"],
    target: ["production"],
  };
}

function makeDeps(opts: {
  state?: Partial<InstanceState> | null;
  existingEnv?: VercelEnvVar[];
  latestDeployment?: Record<string, unknown> | null;
  deploymentStates?: string[];
  httpStatus?: number;
  httpBody?: string;
  nowMs?: number;
}) {
  const stored: Record<string, InstanceState> =
    opts.state === null
      ? {}
      : {
          provtest1: {
            subdomain: "provtest1",
            projectRef: "ref123",
            apiUrl: URL_VALUE,
            anonKey: ANON_VALUE,
            serviceKey: SERVICE_VALUE,
            ...opts.state,
          },
        };

  const states = [...(opts.deploymentStates ?? ["READY"])];
  let now = opts.nowMs ?? 1_000_000;

  const vercel = {
    getProject: vi.fn(async () => ({ id: "prj", name: "aims-higher" })),
    listEnv: vi.fn(async () => opts.existingEnv ?? []),
    // Typed param so the assertions can read the created spec back.
    createEnv: vi.fn(async (input: { key: string; type: string; target: string[] }) => {
      void input;
      return {};
    }),
    updateEnv: vi.fn(async (_id: string, _input: unknown) => ({})),
    latestProductionDeployment: vi.fn(async () =>
      opts.latestDeployment === undefined
        ? { uid: "dpl_old", created: 500_000, readyState: "READY" }
        : opts.latestDeployment
    ),
    redeploy: vi.fn(async () => ({ uid: "dpl_new" })),
    getDeployment: vi.fn(async () => ({ readyState: states.shift() ?? "READY" })),
  };

  const deps = {
    management: {} as ProvisionDeps["management"],
    organizationId: "org1",
    vercel,
    httpGet: vi.fn(async () => ({
      status: opts.httpStatus ?? 200,
      body: opts.httpBody ?? "<h1>There's no AiMS Higher instance at this address</h1>",
    })),
    readState: (s: string) => stored[s] ?? null,
    writeState: (s: string, patch: Partial<InstanceState>) => {
      stored[s] = { ...(stored[s] ?? { subdomain: s }), ...patch };
      return stored[s];
    },
    runCommand: vi.fn(),
    localMigrations: () => [],
    readSeedSql: () => "",
    log: vi.fn(),
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  } as unknown as ProvisionDeps;

  return { deps, stored, vercel };
}

describe("planEnvVar", () => {
  const fp = fingerprint;

  it("creates when the variable is absent", () => {
    expect(
      planEnvVar({ key: "K", desiredValue: "v", type: "encrypted", fingerprintOf: fp })
    ).toMatchObject({ action: "create" });
  });

  it("skips when the recorded fingerprint matches, whatever the type", () => {
    for (const type of ["encrypted", "sensitive"] as const) {
      expect(
        planEnvVar({
          key: "K",
          desiredValue: SERVICE_VALUE,
          type,
          existing: envVar("K", undefined, type),
          recordedFingerprint: fp(SERVICE_VALUE),
          fingerprintOf: fp,
        }),
        type
      ).toMatchObject({ action: "skip" });
    }
  });

  it("updates when the fingerprint differs", () => {
    expect(
      planEnvVar({
        key: "K",
        desiredValue: "rotated",
        type: "sensitive",
        existing: envVar("K", undefined, "sensitive"),
        recordedFingerprint: fp("original"),
        fingerprintOf: fp,
      })
    ).toMatchObject({ action: "update", reason: "value changed" });
  });

  it("rewrites a variable we have no fingerprint for", () => {
    // Set by hand, or by a run predating the fingerprint. It cannot be
    // compared, so it is rewritten rather than assumed correct.
    expect(
      planEnvVar({
        key: "K",
        desiredValue: "v",
        type: "encrypted",
        existing: envVar("K", undefined, "encrypted"),
        fingerprintOf: fp,
      })
    ).toMatchObject({ action: "update" });
  });

  it("NEVER compares against the value Vercel returns", () => {
    // Vercel hands back ciphertext for an encrypted variable and an
    // empty string for a sensitive one, so a value comparison can
    // never match and would rewrite production config on every run.
    // Measured on the real project. This pins the regression.
    const ciphertext = "eyJ2IjoidjIi" + "x".repeat(1100);
    expect(
      planEnvVar({
        key: "K",
        desiredValue: "the-real-value",
        type: "encrypted",
        existing: envVar("K", ciphertext, "encrypted"),
        recordedFingerprint: fp("the-real-value"),
        fingerprintOf: fp,
      })
    ).toMatchObject({ action: "skip" });
  });
});

describe("write-vercel-env", () => {
  it("creates all three on a fresh project, service key sensitive", async () => {
    const { deps, vercel } = makeDeps({ existingEnv: [] });

    const result = await WRITE_ENV.execute(CTX, deps);

    expect(result.status).toBe("done");
    expect(vercel.createEnv).toHaveBeenCalledTimes(3);
    const created = vercel.createEnv.mock.calls.map((c) => c[0]);
    expect(created.map((c) => c.key)).toEqual([
      "PROVTEST1_SUPABASE_URL",
      "PROVTEST1_SUPABASE_ANON_KEY",
      "PROVTEST1_SUPABASE_SERVICE_KEY",
    ]);
    expect(created.map((c) => c.type)).toEqual([
      "encrypted",
      "encrypted",
      "sensitive",
    ]);
    for (const c of created) expect(c.target).toEqual(["production"]);
  });

  it("never logs a value, only names", async () => {
    // The service key is the whole reason this matters.
    const { deps } = makeDeps({ existingEnv: [] });
    await WRITE_ENV.execute(CTX, deps);

    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(logged).toContain("PROVTEST1_SUPABASE_SERVICE_KEY");
    expect(logged).not.toContain(SERVICE_VALUE);
    expect(logged).not.toContain(ANON_VALUE);
  });

  it("skips entirely when all three already match", async () => {
    const { deps, vercel } = makeDeps({
      state: {
        envFingerprints: {
          PROVTEST1_SUPABASE_URL: fingerprint(URL_VALUE),
          PROVTEST1_SUPABASE_ANON_KEY: fingerprint(ANON_VALUE),
          PROVTEST1_SUPABASE_SERVICE_KEY: fingerprint(SERVICE_VALUE),
        },
      },
      existingEnv: [
        // Values as Vercel actually returns them: ciphertext and empty.
        envVar("PROVTEST1_SUPABASE_URL", "eyJ2IjoidjIiciphertext", "encrypted"),
        envVar("PROVTEST1_SUPABASE_ANON_KEY", "eyJ2IjoidjIiciphertext", "encrypted"),
        envVar("PROVTEST1_SUPABASE_SERVICE_KEY", "", "sensitive"),
      ],
    });

    const result = await WRITE_ENV.execute(CTX, deps);

    expect(result.status).toBe("skipped");
    expect(vercel.createEnv).not.toHaveBeenCalled();
    expect(vercel.updateEnv).not.toHaveBeenCalled();
  });

  it("updates a changed value and says so", async () => {
    const { deps, vercel } = makeDeps({
      state: {
        envFingerprints: {
          // The URL we last wrote is not the one in the state file now.
          PROVTEST1_SUPABASE_URL: fingerprint("https://stale.supabase.co"),
          PROVTEST1_SUPABASE_ANON_KEY: fingerprint(ANON_VALUE),
          PROVTEST1_SUPABASE_SERVICE_KEY: fingerprint(SERVICE_VALUE),
        },
      },
      existingEnv: [
        envVar("PROVTEST1_SUPABASE_URL", "", "encrypted"),
        envVar("PROVTEST1_SUPABASE_ANON_KEY", "", "encrypted"),
        envVar("PROVTEST1_SUPABASE_SERVICE_KEY", "", "sensitive"),
      ],
    });

    const result = await WRITE_ENV.execute(CTX, deps);

    expect(result.status).toBe("done");
    expect(result.detail).toContain("1 updated");
    expect(vercel.updateEnv).toHaveBeenCalledTimes(1);
  });

  it("ignores a variable of the same name on another environment", async () => {
    // A preview-scoped variable must not be mistaken for the
    // production one.
    const previewOnly = {
      ...envVar("PROVTEST1_SUPABASE_URL", URL_VALUE, "encrypted"),
      target: ["preview"],
    };
    const { deps, vercel } = makeDeps({ existingEnv: [previewOnly] });

    await WRITE_ENV.execute(CTX, deps);
    expect(vercel.createEnv).toHaveBeenCalledTimes(3);
  });

  it("records the fingerprint and the write time", async () => {
    const { deps, stored } = makeDeps({ existingEnv: [], nowMs: 5_000_000 });
    await WRITE_ENV.execute(CTX, deps);

    expect(stored.provtest1.envFingerprints).toEqual({
      PROVTEST1_SUPABASE_URL: fingerprint(URL_VALUE),
      PROVTEST1_SUPABASE_ANON_KEY: fingerprint(ANON_VALUE),
      PROVTEST1_SUPABASE_SERVICE_KEY: fingerprint(SERVICE_VALUE),
    });
    expect(stored.provtest1.envWrittenAt).toBe(new Date(5_000_000).toISOString());
  });

  it("refuses before the project has keys", async () => {
    const { deps } = makeDeps({ state: null });
    await expect(WRITE_ENV.execute(CTX, deps)).rejects.toThrow(
      /create-supabase-project first/
    );
  });
});

describe("waitForDeployment", () => {
  const clock = () => {
    let now = 0;
    return { now: () => now, sleep: async (ms: number) => { now += ms; } };
  };

  it("returns when the deployment is READY", async () => {
    const c = clock();
    await expect(
      waitForDeployment({ id: "d", getState: async () => "READY", ...c })
    ).resolves.toBe("READY");
  });

  it("fails fast on a terminal failure instead of waiting out the timeout", async () => {
    const c = clock();
    await expect(
      waitForDeployment({ id: "d", getState: async () => "ERROR", ...c })
    ).rejects.toBeInstanceOf(DeploymentFailedError);
    expect(c.now()).toBe(0);
  });

  it("times out on a deployment that never finishes", async () => {
    const c = clock();
    await expect(
      waitForDeployment({
        id: "d",
        getState: async () => "BUILDING",
        ...c,
        timeoutMs: 30_000,
        intervalMs: 10_000,
      })
    ).rejects.toBeInstanceOf(DeploymentTimeoutError);
  });
});

describe("trigger-redeploy", () => {
  it("redeploys and waits when the env was written after the last deployment", async () => {
    const { deps, vercel, stored } = makeDeps({
      state: { envWrittenAt: new Date(900_000).toISOString() },
      latestDeployment: { uid: "dpl_old", created: 500_000, readyState: "READY" },
      deploymentStates: ["BUILDING", "READY"],
    });

    const result = await REDEPLOY.execute(CTX, deps);

    expect(result.status).toBe("done");
    expect(vercel.redeploy).toHaveBeenCalledWith({
      name: "aims-higher",
      deploymentId: "dpl_old",
    });
    expect(stored.provtest1.deploymentId).toBe("dpl_new");
  });

  it("skips when the current deployment already postdates the env write", async () => {
    // The rerun case, and the common one.
    const { deps, vercel } = makeDeps({
      state: { envWrittenAt: new Date(400_000).toISOString() },
      latestDeployment: { uid: "dpl_new", created: 900_000, readyState: "READY" },
    });

    const result = await REDEPLOY.execute(CTX, deps);

    expect(result.status).toBe("skipped");
    expect(vercel.redeploy).not.toHaveBeenCalled();
  });

  it("does not skip on a newer deployment that is not READY", async () => {
    const { deps, vercel } = makeDeps({
      state: { envWrittenAt: new Date(400_000).toISOString() },
      latestDeployment: { uid: "dpl_x", created: 900_000, readyState: "BUILDING" },
      deploymentStates: ["READY"],
    });

    await REDEPLOY.execute(CTX, deps);
    expect(vercel.redeploy).toHaveBeenCalled();
  });

  it("explains that production is untouched when the build fails", async () => {
    const { deps } = makeDeps({
      state: { envWrittenAt: new Date(900_000).toISOString() },
      latestDeployment: { uid: "dpl_old", created: 500_000, readyState: "READY" },
      deploymentStates: ["ERROR"],
    });

    await expect(REDEPLOY.execute(CTX, deps)).rejects.toThrow(/nothing is down/);
  });

  it("refuses when there is no production deployment to redeploy from", async () => {
    const { deps } = makeDeps({ latestDeployment: null });
    await expect(REDEPLOY.execute(CTX, deps)).rejects.toThrow(
      /no production deployment/
    );
  });
});

describe("verify-instance (groundwork)", () => {
  it("requires the no-instance page, which is correct until the registry row lands", async () => {
    const { deps } = makeDeps({});
    const result = await VERIFY.execute(CTX, deps);

    expect(result.status).toBe("done");
    expect(deps.httpGet).toHaveBeenCalledWith(
      "https://provtest1.aims-hq.com/sign-in"
    );
  });

  it("fails when the subdomain is not served at all", async () => {
    const { deps } = makeDeps({ httpStatus: 404 });
    await expect(VERIFY.execute(CTX, deps)).rejects.toThrow(
      /wildcard DNS or the certificate/
    );
  });

  it("fails when the hostname resolves to an instance it should not have", async () => {
    // A sign-in page here means a registry row exists that
    // provisioning did not write.
    const { deps } = makeDeps({ httpBody: "<form>Password</form>" });
    await expect(VERIFY.execute(CTX, deps)).rejects.toThrow(
      /insert-registry-row is implemented/
    );
  });
});
