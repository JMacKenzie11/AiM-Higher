import { describe, it, expect } from "vitest";

import {
  PROVISION_STEPS,
  STEP_NAMES,
  type ProvisionContext,
  type ProvisionDeps,
} from "./plan.ts";

// Steps that no longer print and return — they reach the network now,
// so the "still stubbed" assertion below has to stop covering them as
// each one lands. See supabase-management.test.ts for their coverage.
const IMPLEMENTED = new Set([
  "create-supabase-project",
  "apply-migrations",
  "seed-data",
  "write-vercel-env",
  "trigger-redeploy",
  "verify-instance",
]);

const NO_DEPS = {} as ProvisionDeps;

// The order is the load-bearing part. The API calls are the easy half;
// getting "register it only once it works" wrong leaves a customer
// live and broken.

const CTX: ProvisionContext = {
  subdomain: "acmecapital",
  envPrefix: "ACMECAPITAL",
  displayName: "Acme Capital",
  adminEmail: "jeff@acmecapital.com",
  region: "us-east-1",
  dryRun: false,
};

describe("the provisioning plan", () => {
  it("is exactly these steps, in this order", () => {
    expect(STEP_NAMES).toEqual([
      "check-preconditions",
      "create-supabase-project",
      "apply-migrations",
      "seed-data",
      "write-vercel-env",
      "trigger-redeploy",
      "insert-registry-row",
      "create-admin",
      "verify-instance",
    ]);
  });

  it("checks preconditions before creating anything", () => {
    expect(STEP_NAMES[0]).toBe("check-preconditions");
  });

  it("registers the instance only after its database is ready", () => {
    // The registry row is what makes a hostname resolve. Writing it
    // before the project is migrated and seeded publishes a broken
    // instance to real traffic.
    const registry = STEP_NAMES.indexOf("insert-registry-row");
    for (const earlier of [
      "create-supabase-project",
      "apply-migrations",
      "seed-data",
    ]) {
      expect(
        STEP_NAMES.indexOf(earlier),
        `${earlier} must precede insert-registry-row`
      ).toBeLessThan(registry);
    }
  });

  it("writes the Vercel env before redeploying", () => {
    // The deployment reads {PREFIX}_SUPABASE_* at runtime; the
    // redeploy is what picks the new values up.
    expect(STEP_NAMES.indexOf("write-vercel-env")).toBeLessThan(
      STEP_NAMES.indexOf("trigger-redeploy")
    );
  });

  it("verifies last", () => {
    // "Provisioning succeeded" is not the same claim as "a person can
    // sign in".
    expect(STEP_NAMES[STEP_NAMES.length - 1]).toBe("verify-instance");
  });

  it("has no duplicate step names", () => {
    expect(new Set(STEP_NAMES).size).toBe(STEP_NAMES.length);
  });

  it("gives every step a description that resolves the context", () => {
    for (const step of PROVISION_STEPS) {
      const described = step.describe(CTX);
      expect(described.length, step.name).toBeGreaterThan(0);
      // No unresolved template leftovers.
      expect(described, step.name).not.toContain("${");
    }
  });

  it("mentions the resolved values where they matter", () => {
    const byName = Object.fromEntries(PROVISION_STEPS.map((s) => [s.name, s]));
    expect(byName["create-supabase-project"].describe(CTX)).toContain(
      CTX.region
    );
    expect(byName["write-vercel-env"].describe(CTX)).toContain(CTX.envPrefix);
    expect(byName["insert-registry-row"].describe(CTX)).toContain(
      CTX.subdomain
    );
    expect(byName["create-admin"].describe(CTX)).toContain(CTX.adminEmail);
  });

  it("is independently executable, step by step", () => {
    // Each step is a plain object with its own execute taking the
    // context and its dependencies. The runner walks them; nothing
    // shares state through a closure, and nothing reaches the outside
    // world except through deps.
    for (const step of PROVISION_STEPS) {
      expect(typeof step.execute, step.name).toBe("function");
      expect(step.execute.length, `${step.name} takes (ctx, deps)`).toBe(2);
    }
  });

  it("returns a result rather than printing, so a runner can report it", async () => {
    for (const step of PROVISION_STEPS) {
      if (IMPLEMENTED.has(step.name)) continue;
      const result = await step.execute(CTX, NO_DEPS);
      expect(["done", "skipped"], step.name).toContain(result.status);
      expect(result.detail.length, step.name).toBeGreaterThan(0);
    }
  });

  it("the remaining steps are still stubbed, and say so", async () => {
    // When a step grows a real implementation this is the test that
    // fails, so nobody ships a half-real plan believing it is inert.
    // Add the step to IMPLEMENTED as it lands — deliberately a manual
    // edit, so the change is visible in the diff.
    for (const step of PROVISION_STEPS) {
      if (IMPLEMENTED.has(step.name)) continue;
      const result = await step.execute(CTX, NO_DEPS);
      expect(result.detail, step.name).toMatch(/^stub — would /);
    }
  });

  it("names every implemented step in IMPLEMENTED", () => {
    for (const name of IMPLEMENTED) {
      expect(STEP_NAMES, `${name} is not a step`).toContain(name);
    }
  });
});
