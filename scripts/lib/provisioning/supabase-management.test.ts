import { describe, it, expect, vi } from "vitest";

import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  HEALTHY_STATUS,
  ManagementApiError,
  ProjectNotHealthyError,
  createManagementClient,
  projectNameFor,
  waitForHealthy,
} from "./supabase-management.ts";

// A fake clock and sleep, so the real polling loop — including its ten
// minute timeout — runs in microseconds. Sleeping advances the clock,
// which is the only coupling the loop actually has to time.
function fakeTime(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("projectNameFor", () => {
  it("is the convention both creation and recognition use", () => {
    // Idempotency depends on these being one function. If creation and
    // lookup ever disagree, provisioning silently creates a second
    // project for the same customer.
    expect(projectNameFor("acmecapital")).toBe("aims-higher-acmecapital");
    expect(projectNameFor("acme-capital")).toBe("aims-higher-acme-capital");
  });
});

describe("waitForHealthy", () => {
  it("returns immediately when the project is already healthy", async () => {
    // The resume case: a project found healthy must not wait a poll
    // interval to say so.
    const clock = fakeTime();
    const getStatus = vi.fn().mockResolvedValue(HEALTHY_STATUS);

    const status = await waitForHealthy({
      ref: "abc",
      getStatus,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(status).toBe(HEALTHY_STATUS);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBe(0);
  });

  it("polls until the project comes up", async () => {
    const clock = fakeTime();
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce("COMING_UP")
      .mockResolvedValueOnce("COMING_UP")
      .mockResolvedValueOnce(HEALTHY_STATUS);

    const status = await waitForHealthy({
      ref: "abc",
      getStatus,
      now: clock.now,
      sleep: clock.sleep,
      intervalMs: 10_000,
    });

    expect(status).toBe(HEALTHY_STATUS);
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(clock.now()).toBe(20_000);
  });

  it("reports progress on every poll", async () => {
    const clock = fakeTime();
    const onTick = vi.fn();
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce("COMING_UP")
      .mockResolvedValueOnce(HEALTHY_STATUS);

    await waitForHealthy({
      ref: "abc",
      getStatus,
      now: clock.now,
      sleep: clock.sleep,
      onTick,
      intervalMs: 5_000,
    });

    // A step that can take several minutes in silence looks hung.
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onTick).toHaveBeenNthCalledWith(1, "COMING_UP", 0);
    expect(onTick).toHaveBeenNthCalledWith(2, HEALTHY_STATUS, 5_000);
  });

  it("gives up after the timeout, naming the last status", async () => {
    const clock = fakeTime();
    const getStatus = vi.fn().mockResolvedValue("COMING_UP");

    await expect(
      waitForHealthy({
        ref: "stuck-ref",
        getStatus,
        now: clock.now,
        sleep: clock.sleep,
        timeoutMs: 60_000,
        intervalMs: 10_000,
      })
    ).rejects.toThrow(ProjectNotHealthyError);

    // Six sleeps to reach 60s, then the seventh check trips it.
    expect(getStatus).toHaveBeenCalledTimes(7);
  });

  it("carries the ref and last status on the timeout error", async () => {
    const clock = fakeTime();
    try {
      await waitForHealthy({
        ref: "stuck-ref",
        getStatus: async () => "INACTIVE",
        now: clock.now,
        sleep: clock.sleep,
        timeoutMs: 1_000,
        intervalMs: 1_000,
      });
      throw new Error("expected a timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectNotHealthyError);
      const e = error as ProjectNotHealthyError;
      // The runner turns these into "rerunning resumes from it".
      expect(e.ref).toBe("stuck-ref");
      expect(e.lastStatus).toBe("INACTIVE");
      expect(e.message).toContain("INACTIVE");
    }
  });

  it("defaults to a ten minute budget", () => {
    expect(DEFAULT_HEALTH_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });

  it("treats a project that has vanished as not healthy rather than crashing", async () => {
    // getProject returns null on 404 while the platform catches up;
    // the step maps that to UNKNOWN, and the loop must keep waiting.
    const clock = fakeTime();
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce("UNKNOWN")
      .mockResolvedValueOnce(HEALTHY_STATUS);

    await expect(
      waitForHealthy({
        ref: "abc",
        getStatus,
        now: clock.now,
        sleep: clock.sleep,
        intervalMs: 1_000,
      })
    ).resolves.toBe(HEALTHY_STATUS);
  });
});

describe("createManagementClient", () => {
  function fakeFetch(
    responses: Array<{ ok?: boolean; status?: number; body: unknown }>
  ) {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    let i = 0;
    const fetchImpl = vi.fn(async (url: string, init?: Record<string, unknown>) => {
      calls.push({
        url,
        method: init?.method as string | undefined,
        body: init?.body as string | undefined,
      });
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return {
        ok: next.ok ?? true,
        status: next.status ?? 200,
        text: async () =>
          typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      };
    });
    return { fetchImpl, calls };
  }

  it("sends the token as a bearer and parses the response", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { body: [{ id: "ref1", name: "aims-higher-acme", region: "us-east-1", status: HEALTHY_STATUS }] },
    ]);
    const client = createManagementClient({ token: "tok", fetchImpl });

    const projects = await client.listProjects();

    expect(projects[0].id).toBe("ref1");
    expect(calls[0].url).toBe("https://api.supabase.com/v1/projects");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("throws with the status AND the body on failure", async () => {
    // A Management API failure is almost always explained by its body
    // and almost never by its status alone.
    const { fetchImpl } = fakeFetch([
      { ok: false, status: 402, body: '{"message":"free tier project limit reached"}' },
    ]);
    const client = createManagementClient({ token: "tok", fetchImpl });

    await expect(client.listProjects()).rejects.toThrow(ManagementApiError);
    await expect(client.listProjects()).rejects.toThrow(/402/);
    await expect(client.listProjects()).rejects.toThrow(/free tier project limit/);
  });

  it("maps a 404 on getProject to null rather than an error", async () => {
    // A just-created project reads as 404 while the platform catches
    // up. That is "not yet", not a failure.
    const { fetchImpl } = fakeFetch([{ ok: false, status: 404, body: "" }]);
    const client = createManagementClient({ token: "tok", fetchImpl });

    await expect(client.getProject("ref1")).resolves.toBeNull();
  });

  it("still throws on a non-404 failure from getProject", async () => {
    const { fetchImpl } = fakeFetch([{ ok: false, status: 500, body: "boom" }]);
    const client = createManagementClient({ token: "tok", fetchImpl });

    await expect(client.getProject("ref1")).rejects.toThrow(ManagementApiError);
  });

  it("posts the project body the API expects", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { body: { id: "new1", name: "aims-higher-acme", region: "us-east-1", status: "COMING_UP" } },
    ]);
    const client = createManagementClient({ token: "tok", fetchImpl });

    await client.createProject({
      name: "aims-higher-acme",
      organizationId: "org1",
      region: "us-east-1",
      dbPass: "secret",
    });

    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body as string)).toEqual({
      name: "aims-higher-acme",
      organization_id: "org1",
      region: "us-east-1",
      db_pass: "secret",
    });
  });

  it("asks for the revealed key values", async () => {
    // Without reveal the API returns metadata and no secret, which
    // would leave the instance with no way to connect.
    const { fetchImpl, calls } = fakeFetch([{ body: [] }]);
    const client = createManagementClient({ token: "tok", fetchImpl });

    await client.getApiKeys("ref1");

    expect(calls[0].url).toContain("/v1/projects/ref1/api-keys");
    expect(calls[0].url).toContain("reveal=true");
  });
});
