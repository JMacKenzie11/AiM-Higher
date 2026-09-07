import { describe, it, expect, vi } from "vitest";

import {
  PROVISION_STEPS,
  type ProvisionContext,
  type ProvisionDeps,
} from "./plan.ts";

const CHECK = PROVISION_STEPS.find((s) => s.name === "check-preconditions")!;

const CTX: ProvisionContext = {
  subdomain: "acmecapital",
  envPrefix: "ACMECAPITAL",
  displayName: "Acme Capital",
  adminEmail: "us@aims-institute.com",
  region: "us-east-1",
  dryRun: false,
};

function makeDeps(opts: {
  listProjects?: () => Promise<unknown>;
  getProject?: () => Promise<{ id: string; name: string }>;
  registryRow?: { subdomain: string; env_prefix: string; status: string } | null;
  httpStatus?: number;
  httpThrows?: boolean;
} = {}) {
  return {
    management: {
      listProjects: vi.fn(opts.listProjects ?? (async () => [])),
    },
    vercel: {
      getProject: vi.fn(
        opts.getProject ?? (async () => ({ id: "prj", name: "aims-higher" }))
      ),
    },
    getRegistryRow: vi.fn(async () => opts.registryRow ?? null),
    httpGet: vi.fn(async () => {
      if (opts.httpThrows) throw new Error("getaddrinfo ENOTFOUND");
      return { status: opts.httpStatus ?? 200, body: "" };
    }),
    log: vi.fn(),
  } as unknown as ProvisionDeps;
}

describe("check-preconditions", () => {
  it("passes when everything is in place", async () => {
    const deps = makeDeps();
    const result = await CHECK.execute(CTX, deps);

    expect(result.status).toBe("done");
    expect(result.detail).toContain("4 checks");
  });

  it("fails on a bad Supabase management token, naming it", async () => {
    // Otherwise this surfaces at step 2, having already been billed
    // for nothing.
    const deps = makeDeps({
      listProjects: async () => {
        throw new Error("Supabase Management API GET /v1/projects failed: 401\nunauthorized");
      },
    });
    await expect(CHECK.execute(CTX, deps)).rejects.toThrow(
      /SUPABASE_MANAGEMENT_TOKEN was rejected/
    );
  });

  it("fails on a bad Vercel token or project id, naming both", async () => {
    // They come from the same file and either can be wrong alone.
    const deps = makeDeps({
      getProject: async () => {
        throw new Error("Vercel API GET /v9/projects/x failed: 403\nforbidden");
      },
    });
    await expect(CHECK.execute(CTX, deps)).rejects.toThrow(
      /VERCEL_TOKEN \/ VERCEL_PROJECT_ID rejected/
    );
  });

  it("refuses a subdomain registered to a different instance", async () => {
    // The dangerous case: step 7 would overwrite the row and silently
    // repoint a live hostname at another database.
    const deps = makeDeps({
      registryRow: {
        subdomain: "acmecapital",
        env_prefix: "SOMEONEELSE",
        status: "active",
      },
    });
    await expect(CHECK.execute(CTX, deps)).rejects.toThrow(
      /repoint a live hostname at a different database/
    );
  });

  it("allows a rerun against its own existing row", async () => {
    const deps = makeDeps({
      registryRow: {
        subdomain: "acmecapital",
        env_prefix: "ACMECAPITAL",
        status: "active",
      },
    });
    const result = await CHECK.execute(CTX, deps);
    expect(result.status).toBe("done");
  });

  it("fails when the wildcard does not cover the subdomain", async () => {
    // Otherwise everything gets built and step 9 fails last.
    const deps = makeDeps({ httpThrows: true });
    await expect(CHECK.execute(CTX, deps)).rejects.toThrow(
      /wildcard DNS record or its certificate/
    );
  });

  it("accepts the no-instance page as proof the wildcard works", async () => {
    // Whether the hostname resolves to an instance is step 9's
    // business. This only needs DNS and a certificate.
    const deps = makeDeps({ httpStatus: 200 });
    await expect(CHECK.execute(CTX, deps)).resolves.toMatchObject({
      status: "done",
    });
  });

  it("treats a 5xx as the wildcard being broken", async () => {
    const deps = makeDeps({ httpStatus: 503 });
    await expect(CHECK.execute(CTX, deps)).rejects.toThrow(/not reachable/);
  });

  it("runs before anything is created", () => {
    // The whole point: first in the plan, so a bad token costs a
    // second rather than ten minutes and a billed project.
    expect(PROVISION_STEPS[0].name).toBe("check-preconditions");
  });
});
