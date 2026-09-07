import { describe, it, expect, vi } from "vitest";

import {
  PROVISION_STEPS,
  type ProvisionContext,
  type ProvisionDeps,
} from "./plan.ts";
import type { InstanceState } from "./state.ts";

// The step that writes an instance's credentials into
// .env.provisioning, the one file fleet tools read.
//
// It exists because the loud failure it prevents is correct and
// unhelpful on its own: sync-content refused to run on 2026-09-07
// because nobody had hand-added PROD_SUPABASE_SERVICE_KEY or either
// PROMISEONE_* value. Two instances is manageable by hand. Five is
// not, and the failure lands on whoever did NOT provision the
// instance.

const step = PROVISION_STEPS.find((s) => s.name === "record-fleet-credentials")!;

const ctx: ProvisionContext = {
  subdomain: "acme",
  envPrefix: "ACME",
  displayName: "Acme",
  adminEmail: "ours@aims-institute.com",
  region: "us-east-1",
  dryRun: false,
};

const STATE: InstanceState = {
  subdomain: "acme",
  apiUrl: "https://acmeref.supabase.co",
  serviceKey: "sb_secret_acme",
} as InstanceState;

function deps(over: Partial<ProvisionDeps> = {}): ProvisionDeps {
  return {
    readState: () => STATE,
    recordFleetCredentials: () => ({ added: [], alreadyPresent: [] }),
    ...over,
  } as unknown as ProvisionDeps;
}

describe("record-fleet-credentials", () => {
  it("is in the plan, after the instance exists", () => {
    const names = PROVISION_STEPS.map((s) => s.name);
    expect(names).toContain("record-fleet-credentials");
    // It reads the state file's URL and key, so the project has to
    // have been created first.
    expect(names.indexOf("record-fleet-credentials")).toBeGreaterThan(
      names.indexOf("create-supabase-project")
    );
  });

  it("writes both variables the fleet tools read", async () => {
    const record = vi.fn(() => ({
      added: ["ACME_SUPABASE_URL", "ACME_SUPABASE_SERVICE_KEY"],
      alreadyPresent: [],
    }));
    const result = await step.execute(ctx, deps({ recordFleetCredentials: record }));

    expect(record).toHaveBeenCalledWith({
      ACME_SUPABASE_URL: "https://acmeref.supabase.co",
      ACME_SUPABASE_SERVICE_KEY: "sb_secret_acme",
    });
    expect(result.status).toBe("done");
  });

  it("names the keys but never the values", async () => {
    // The value is a service-role key. A secret must not appear in a
    // command's output; see E3 in docs/failure-modes.md.
    const result = await step.execute(
      ctx,
      deps({
        recordFleetCredentials: () => ({
          added: ["ACME_SUPABASE_URL", "ACME_SUPABASE_SERVICE_KEY"],
          alreadyPresent: [],
        }),
      })
    );
    expect(result.detail).toContain("ACME_SUPABASE_SERVICE_KEY");
    expect(result.detail).not.toContain("sb_secret_acme");
    expect(result.detail).not.toContain("acmeref.supabase.co");
  });

  it("reports skipped on a rerun", async () => {
    const result = await step.execute(
      ctx,
      deps({
        recordFleetCredentials: () => ({
          added: [],
          alreadyPresent: ["ACME_SUPABASE_URL", "ACME_SUPABASE_SERVICE_KEY"],
        }),
      })
    );
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("2 already");
  });

  it("refuses when the project has not been created yet", async () => {
    await expect(
      step.execute(ctx, deps({ readState: () => null }))
    ).rejects.toThrow(/create-supabase-project/);
  });

  it("refuses when the state file has no service key", async () => {
    await expect(
      step.execute(
        ctx,
        deps({ readState: () => ({ subdomain: "acme", apiUrl: "u" }) as InstanceState })
      )
    ).rejects.toThrow(/no URL or service key/);
  });
});
