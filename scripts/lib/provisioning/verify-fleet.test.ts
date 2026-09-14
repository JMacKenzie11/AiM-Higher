import { describe, it, expect } from "vitest";
import { verifyAllInstances, summarize } from "./verify-fleet.ts";
import type { RegistryRow } from "./migrate.ts";
import type { InstanceState } from "./state.ts";

// Post-apply fleet verification. The contracts worth pinning are all
// about what counts as a FAILURE, because the failure modes this
// exists to catch are the ones that look like success.

const LOCAL = ["0001_a.sql", "0002_b.sql", "0003_c.sql"];

function row(subdomain: string, status = "active"): RegistryRow {
  return { subdomain, env_prefix: subdomain.toUpperCase(), status };
}

// resolveTarget reads a state file for non-primary instances, so a
// fake one is what makes a row resolvable at all.
const state = (subdomain: string): InstanceState | null =>
  ({ projectRef: `ref_${subdomain}`, dbPassword: "pw" }) as InstanceState;

describe("verifyAllInstances", () => {
  it("reports an instance carrying every local migration as current", async () => {
    const verdicts = await verifyAllInstances({
      rows: [row("alpha")],
      env: {},
      readState: state,
      localMigrations: LOCAL,
      appliedVersionsFor: async () => new Set(["0001", "0002", "0003"]),
    });
    expect(verdicts).toEqual([
      { subdomain: "alpha", state: "current", version: "0003" },
    ]);
  });

  it("names the missing versions when an instance is behind", async () => {
    const verdicts = await verifyAllInstances({
      rows: [row("alpha")],
      env: {},
      readState: state,
      localMigrations: LOCAL,
      appliedVersionsFor: async () => new Set(["0001"]),
    });
    expect(verdicts[0]).toMatchObject({
      state: "behind",
      version: "0001",
      missing: ["0002_b.sql", "0003_c.sql"],
    });
  });

  it("treats a database that will not answer as BLOCKED, not as empty", async () => {
    // migrate:instances reads an absent ledger as "nothing applied"
    // on purpose, because it is about to push into it. The same guess
    // here would report a healthy instance as catastrophically behind,
    // or hide a network failure behind a number.
    const verdicts = await verifyAllInstances({
      rows: [row("alpha")],
      env: {},
      readState: state,
      localMigrations: LOCAL,
      appliedVersionsFor: async () => {
        throw new Error("connection refused");
      },
    });
    expect(verdicts[0]).toMatchObject({ state: "blocked" });
    expect((verdicts[0] as { reason: string }).reason).toContain(
      "connection refused"
    );
  });

  it("blocks an instance it cannot resolve credentials for", async () => {
    const verdicts = await verifyAllInstances({
      rows: [row("alpha")],
      env: {},
      readState: () => null,
      localMigrations: LOCAL,
      appliedVersionsFor: async () => new Set(LOCAL.map((f) => f.slice(0, 4))),
    });
    expect(verdicts[0]).toMatchObject({ state: "blocked" });
  });

  it("passes over suspended rows, as migrate:instances does", async () => {
    const verdicts = await verifyAllInstances({
      rows: [row("alpha", "suspended")],
      env: {},
      readState: state,
      localMigrations: LOCAL,
      appliedVersionsFor: async () => new Set(),
    });
    expect(verdicts).toEqual([]);
  });
});

describe("summarize", () => {
  it("passes only when every instance is current", () => {
    const { ok } = summarize(
      [
        { subdomain: "a", state: "current", version: "0003" },
        { subdomain: "b", state: "current", version: "0003" },
      ],
      "0003"
    );
    expect(ok).toBe(true);
  });

  it("FAILS when one instance is unreachable, even if the rest are current", () => {
    // The whole point. Reporting "all good" for the instances that
    // answered is how the unreachable one ends up as the only database
    // still behind with nothing saying so.
    const { ok, lines } = summarize(
      [
        { subdomain: "a", state: "current", version: "0003" },
        { subdomain: "b", state: "blocked", reason: "no credentials" },
      ],
      "0003"
    );
    expect(ok).toBe(false);
    expect(lines.join("\n")).toContain("BLOCKED");
  });

  it("FAILS on an empty fleet rather than calling it clean", () => {
    // A registry read that comes back empty is a question, not a
    // clean bill of health.
    const { ok, lines } = summarize([], "0003");
    expect(ok).toBe(false);
    expect(lines.join("\n")).toContain("check the registry");
  });
});
