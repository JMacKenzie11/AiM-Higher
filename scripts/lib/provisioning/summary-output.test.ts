import { describe, it, expect } from "vitest";

import { summaryLines } from "../../migrate-instances.ts";
import type { InstanceResult } from "./migrate.ts";

// The printed summary, asserted as text.
//
// This is the interface someone reads at the moment they most need it
// — immediately before a deploy, deciding whether to promote — and it
// has already been wrong once. The runner computed an "(also www)"
// alias and never interpolated it, so a database shared by two
// registry rows printed as one with no indication that the second was
// covered. Every test passed: the result objects were correct and the
// rendering was not.
//
// Same principle as the migrations table being the fact and the exit
// code being the claim. What the operator reads is the fact; what the
// object holds is only a claim about it.

const R = (over: Partial<InstanceResult> = {}): InstanceResult =>
  ({
    subdomain: "acme",
    envPrefix: "ACME",
    status: "up-to-date",
    version: "0170",
    ...over,
  }) as InstanceResult;

const joined = (results: InstanceResult[]) => summaryLines(results).join("\n");

describe("summary output", () => {
  it("renders BLOCKED with its reason on the following line", () => {
    const out = joined([
      R({
        subdomain: "@",
        envPrefix: "PROD",
        status: "blocked",
        reason: "PROD_DATABASE_PASSWORD is not set in .env.provisioning.",
      }),
    ]);
    expect(out).toContain("BLOCKED");
    expect(out).toContain("PROD_DATABASE_PASSWORD is not set");
  });

  it("shows only the first line of a multi-line reason", () => {
    // A wrapped paragraph would break the column alignment the eye
    // relies on to scan the table.
    const out = joined([
      R({ status: "blocked", reason: "first line\nsecond line\nthird" }),
    ]);
    expect(out).toContain("first line");
    expect(out).not.toContain("second line");
  });

  it("renders FAILED distinctly from BLOCKED", () => {
    // They mean different things: blocked is "cannot try", failed is
    // "tried and it broke". Reading one as the other sends someone to
    // the wrong place.
    const out = joined([R({ status: "failed", reason: "connection refused" })]);
    expect(out).toContain("FAILED");
    expect(out).not.toContain("BLOCKED");
  });

  it("names the other hostnames a shared database covers", () => {
    // The regression this file exists for.
    const out = joined([
      R({ subdomain: "@", envPrefix: "PROD", aliases: ["www"], version: "0170" }),
    ]);
    expect(out).toContain("(also www)");
  });

  it("carries the alias onto a BLOCKED line too", () => {
    // One failure covering two hostnames is exactly when knowing the
    // second is covered matters most.
    const out = joined([
      R({
        subdomain: "@",
        envPrefix: "PROD",
        status: "blocked",
        reason: "no migration history",
        aliases: ["www"],
      }),
    ]);
    expect(out).toContain("BLOCKED");
    expect(out).toContain("(also www)");
  });

  it("carries the alias onto applied and would-apply lines", () => {
    const applied = joined([
      R({ status: "applied", applied: ["0170_x.sql"], version: "0170", aliases: ["www"] }),
    ]);
    expect(applied).toContain("applied 1 → 0170");
    expect(applied).toContain("(also www)");

    const would = joined([
      R({ status: "would-apply", pending: ["0170_x.sql"], version: "0170", aliases: ["www"] }),
    ]);
    expect(would).toContain("(also www)");
  });

  it("says a dry-run plan was connection verified", () => {
    // Without it the line is a claim about a database that may not be
    // reachable, which is the gap the connectivity check closed.
    const out = joined([
      R({ status: "would-apply", pending: ["0170_x.sql"], version: "0170" }),
    ]);
    expect(out).toContain("would apply 1 → 0170 (connection verified)");
  });

  it("omits the alias entirely when there is none", () => {
    // An empty "(also )" would read as a missing value.
    expect(joined([R()])).not.toContain("also");
    expect(joined([R({ aliases: [] })])).not.toContain("also");
  });

  it("aligns every row to the widest subdomain", () => {
    const lines = summaryLines([
      R({ subdomain: "@" }),
      R({ subdomain: "promiseone" }),
    ]);
    const col = lines.map((l) => l.indexOf("ACME"));
    expect(col[0]).toBe(col[1]);
  });

  it("never prints a connection string", () => {
    // Reasons are surfaced verbatim from the CLI, which is handed a
    // URL carrying the database password.
    const out = joined([
      R({ status: "failed", reason: "failed to connect: password authentication failed" }),
    ]);
    expect(out).not.toContain("postgresql://");
  });
});
