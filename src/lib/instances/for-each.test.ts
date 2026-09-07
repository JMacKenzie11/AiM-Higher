import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fan-out tests. The registry and the admin-client factory are
// mocked, so nothing here opens a socket or reads a real env var.
//
// The properties under test are the ones the fan-out exists for:
// every active instance gets a turn, one instance blowing up cannot
// take the others with it, an instance whose environment variables
// are missing is a failure rather than a skip, and an empty or
// unreadable registry is an error rather than a quiet success.
//
// The log lines are asserted as strings. They are the only routine
// evidence a scheduled run did real work, so a change to their shape
// should have to be deliberate.

const mocks = vi.hoisted(() => ({
  listActiveInstances: vi.fn(),
  lookupInstance: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("./registry", () => ({
  listActiveInstances: mocks.listActiveInstances,
  lookupInstance: mocks.lookupInstance,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

vi.mock("@sentry/nextjs", () => ({
  // withIsolationScope runs the callback with a forked scope and
  // returns whatever it returns; the real one is async-aware, and so
  // is this.
  withIsolationScope: <T>(fn: (scope: { setTag: typeof mocks.setTag }) => T) =>
    fn({ setTag: mocks.setTag }),
  captureException: mocks.captureException,
}));

import { forEachActiveInstance } from "./for-each";
import { instanceFromContext } from "./context";
import type { InstanceConfig } from "./types";

const ACME_ROW = {
  subdomain: "acme",
  displayName: "Acme Industries",
  envPrefix: "ACME",
};
const BETA_ROW = {
  subdomain: "beta",
  displayName: "Beta Co",
  envPrefix: "BETA",
};

function configFor(row: typeof ACME_ROW): InstanceConfig {
  return {
    subdomain: row.subdomain,
    displayName: row.displayName,
    supabaseUrl: `https://${row.subdomain}.supabase.co`,
    supabaseAnonKey: `${row.subdomain}-anon`,
    supabaseServiceKey: `${row.subdomain}-service`,
    status: "active",
  };
}

// A stand-in for the service-role client, identifiable per instance
// so a test can prove the job was handed the right one.
function clientFor(row: typeof ACME_ROW) {
  return { __instance: row.subdomain };
}

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.lookupInstance.mockImplementation(async (subdomain: string) => {
    const row = [ACME_ROW, BETA_ROW].find((r) => r.subdomain === subdomain);
    return row ? configFor(row) : null;
  });
  mocks.createSupabaseAdminClient.mockImplementation(
    async (instance: InstanceConfig) => ({ __instance: instance.subdomain }),
  );
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("forEachActiveInstance: iteration", () => {
  it("runs the job once per active instance, in registry order", async () => {
    mocks.listActiveInstances.mockResolvedValue([ACME_ROW, BETA_ROW]);
    const seen: string[] = [];

    const summary = await forEachActiveInstance({
      job: "transcripts",
      run: async ({ instance }) => {
        seen.push(instance.subdomain);
        return { count: 1 };
      },
      line: (r) => `did ${r.count}`,
    });

    expect(seen).toEqual(["acme", "beta"]);
    expect(summary.ok).toBe(true);
    expect(summary.instances).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);
  });

  it("hands each job that instance's own service-role client", async () => {
    mocks.listActiveInstances.mockResolvedValue([ACME_ROW, BETA_ROW]);
    const clients: unknown[] = [];

    await forEachActiveInstance({
      job: "scorecard",
      run: async ({ admin }) => {
        clients.push(admin);
        return {};
      },
      line: () => "done",
    });

    expect(clients).toEqual([clientFor(ACME_ROW), clientFor(BETA_ROW)]);
  });

  it("exposes the instance to code that reads the ambient scope", async () => {
    // The whole reason the transcript pipeline did not need its nine
    // admin-client call sites rewritten: work several awaits deep
    // resolves to the instance whose turn it is.
    mocks.listActiveInstances.mockResolvedValue([ACME_ROW, BETA_ROW]);
    const seen: Array<string | null> = [];

    await forEachActiveInstance({
      job: "transcripts",
      run: async () => {
        await Promise.resolve();
        seen.push(instanceFromContext()?.subdomain ?? null);
        return {};
      },
      line: () => "done",
    });

    expect(seen).toEqual(["acme", "beta"]);
    // And the scope closes behind it.
    expect(instanceFromContext()).toBeNull();
  });
});

describe("forEachActiveInstance: isolation", () => {
  it("keeps going when the first instance throws", async () => {
    mocks.listActiveInstances.mockResolvedValue([ACME_ROW, BETA_ROW]);
    const seen: string[] = [];

    const summary = await forEachActiveInstance({
      job: "transcripts",
      run: async ({ instance }) => {
        seen.push(instance.subdomain);
        if (instance.subdomain === "acme") {
          throw new Error("drive token expired");
        }
        return { ingested: 3 };
      },
      line: (r) => `ingested ${r.ingested}`,
    });

    // The second instance ran.
    expect(seen).toEqual(["acme", "beta"]);
    expect(summary.outcomes[1]).toMatchObject({
      subdomain: "beta",
      ok: true,
      result: { ingested: 3 },
    });

    // And the first is reported, not swallowed.
    expect(summary.ok).toBe(false);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.outcomes[0]).toMatchObject({
      subdomain: "acme",
      ok: false,
      error: "drive token expired",
    });
    expect(summary.lines).toContain(
      "[transcripts] acme: FAILED: drive token expired",
    );
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });

  it("tags every instance's captured events with its subdomain", async () => {
    mocks.listActiveInstances.mockResolvedValue([ACME_ROW, BETA_ROW]);

    await forEachActiveInstance({
      job: "transcripts",
      run: async () => ({}),
      line: () => "done",
    });

    expect(mocks.setTag).toHaveBeenCalledWith("instance", "acme");
    expect(mocks.setTag).toHaveBeenCalledWith("instance", "beta");
    expect(mocks.setTag).toHaveBeenCalledWith("instance_env_prefix", "ACME");
    expect(mocks.setTag).toHaveBeenCalledWith("cron_job", "transcripts");
  });
});

describe("forEachActiveInstance: missing environment variables", () => {
  it("fails that instance loudly rather than skipping it", async () => {
    mocks.listActiveInstances.mockResolvedValue([ACME_ROW, BETA_ROW]);
    // Registered, active, but its prefix resolves to nothing.
    mocks.lookupInstance.mockImplementation(async (subdomain: string) =>
      subdomain === "acme" ? null : configFor(BETA_ROW),
    );
    const ran: string[] = [];

    const summary = await forEachActiveInstance({
      job: "scorecard",
      run: async ({ instance }) => {
        ran.push(instance.subdomain);
        return {};
      },
      line: () => "done",
    });

    // The job never ran for acme, but the run is red and says why.
    expect(ran).toEqual(["beta"]);
    expect(summary.ok).toBe(false);
    expect(summary.failed).toBe(1);
    expect(summary.instances).toBe(2);
    expect(summary.outcomes[0].error).toContain('env_prefix "ACME"');
    expect(summary.outcomes[0].error).toContain("ACME_SUPABASE_URL");
    expect(summary.lines.some((l) => l.includes("acme: FAILED:"))).toBe(true);
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("forEachActiveInstance: registry problems", () => {
  it("treats an empty active list as an error, not a quiet success", async () => {
    mocks.listActiveInstances.mockResolvedValue([]);
    const run = vi.fn();

    const summary = await forEachActiveInstance({
      job: "transcripts",
      run,
      line: () => "done",
    });

    expect(run).not.toHaveBeenCalled();
    expect(summary.ok).toBe(false);
    expect(summary.instances).toBe(0);
    expect(summary.error).toContain("no active instances");
    expect(summary.lines).toContain("[transcripts] 0 instances: 0 ok, 0 failed");
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });

  it("reports a failed registry lookup without running anything", async () => {
    mocks.listActiveInstances.mockRejectedValue(
      new Error("control plane unreachable"),
    );
    const run = vi.fn();

    const summary = await forEachActiveInstance({
      job: "performance",
      run,
      line: () => "done",
    });

    expect(run).not.toHaveBeenCalled();
    expect(summary.ok).toBe(false);
    expect(summary.error).toBe("control plane unreachable");
    expect(summary.lines).toContain(
      "[performance] registry lookup failed: control plane unreachable",
    );
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });

  it("runs one env_prefix once even if two rows name it", async () => {
    // One database behind two hostnames is still one database, and
    // the performance sweep is not idempotent across two passes.
    mocks.listActiveInstances.mockResolvedValue([
      ACME_ROW,
      { subdomain: "www", displayName: "Acme Industries", envPrefix: "ACME" },
    ]);
    const ran: string[] = [];

    const summary = await forEachActiveInstance({
      job: "performance",
      run: async ({ instance }) => {
        ran.push(instance.subdomain);
        return {};
      },
      line: () => "done",
    });

    expect(ran).toEqual(["acme"]);
    expect(summary.instances).toBe(1);
    expect(summary.ok).toBe(true);
    expect(
      summary.lines.some(
        (l) => l.includes("www: skipped") && l.includes('"ACME"'),
      ),
    ).toBe(true);
  });
});

describe("forEachActiveInstance: summary", () => {
  it("writes one scannable line per instance plus a total", async () => {
    mocks.listActiveInstances.mockResolvedValue([ACME_ROW, BETA_ROW]);

    const summary = await forEachActiveInstance({
      job: "transcripts",
      run: async ({ instance }) => ({
        sources: instance.subdomain === "acme" ? 4 : 1,
        ingested: instance.subdomain === "acme" ? 1 : 0,
      }),
      line: (r) => `checked ${r.sources} sources, ingested ${r.ingested}`,
    });

    expect(summary.lines).toEqual([
      "[transcripts] acme: checked 4 sources, ingested 1",
      "[transcripts] beta: checked 1 sources, ingested 0",
      "[transcripts] 2 instances: 2 ok, 0 failed",
    ]);
    // Logged, not just returned.
    for (const line of summary.lines) {
      expect(logSpy).toHaveBeenCalledWith(line);
    }
  });

  it("counts a mixed run correctly in the final line", async () => {
    mocks.listActiveInstances.mockResolvedValue([ACME_ROW, BETA_ROW]);

    const summary = await forEachActiveInstance({
      job: "scorecard",
      run: async ({ instance }) => {
        if (instance.subdomain === "beta") throw new Error("boom");
        return {};
      },
      line: () => "12/12 companies snapshotted, 0 failed",
    });

    expect(summary.lines.at(-1)).toBe(
      "[scorecard] 2 instances: 1 ok, 1 failed",
    );
    expect(summary.ok).toBe(false);
  });
});
