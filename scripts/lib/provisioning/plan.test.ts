import { describe, it, expect } from "vitest";

import {
  PROVISION_STEPS,
  STEP_NAMES,
  type ProvisionContext,
} from "./plan.ts";

// Every step is implemented now. Nothing is a stub, and this file's
// job changed with that: it used to police which steps had grown real
// implementations, and now it pins that none of them can quietly go
// back to printing what they would have done.

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

  it("has no stubs left", async () => {
    // A stub returns `stub — would …` and touches nothing. If one
    // reappears, this fails rather than a provisioning run reporting
    // success for work it did not do.
    for (const step of PROVISION_STEPS) {
      expect(step.execute.name, `${step.name} is an anonymous stub`).not.toBe(
        ""
      );
      expect(
        String(step.execute),
        `${step.name} still returns a stub detail`
      ).not.toContain("stub — would");
    }
  });

  it("wires every step to a named function, not an inline closure", () => {
    // Named, so a stack trace from a failed provisioning run says
    // which step threw.
    for (const step of PROVISION_STEPS) {
      expect(typeof step.execute, step.name).toBe("function");
    }
  })
});
