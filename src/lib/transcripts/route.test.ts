import { describe, it, expect } from "vitest";
import { routeByFilename, contentHash } from "./route";

// Routing invariants that MUST hold — silently misrouting a
// meeting delivers commitments to the wrong company, so we test
// the exact spec statements: exactly-one-match routes; anything
// else stays unrouted for manual review.

const aliases = [
  { company_id: "acme", alias: "Acme" },
  { company_id: "acme", alias: "acme-corp" },
  { company_id: "meridian", alias: "Meridian" },
  { company_id: "meridian", alias: "MCG" },
];

describe("routeByFilename", () => {
  it("routes on a single alias match", () => {
    const decision = routeByFilename(
      "Acme Q3 planning 2026-07-31.docx",
      aliases
    );
    expect(decision.kind).toBe("routed");
    if (decision.kind === "routed") {
      expect(decision.companyId).toBe("acme");
      expect(decision.alias).toBe("Acme");
    }
  });

  it("matches case-insensitively", () => {
    const decision = routeByFilename("meridian_weekly.vtt", aliases);
    expect(decision.kind).toBe("routed");
    if (decision.kind === "routed") expect(decision.companyId).toBe("meridian");
  });

  it("stays unrouted when the filename matches no alias", () => {
    const decision = routeByFilename(
      "Random client meeting.docx",
      aliases
    );
    expect(decision.kind).toBe("unrouted");
    if (decision.kind === "unrouted") expect(decision.reason).toBe("no_match");
  });

  it("stays unrouted when two companies both match — never guesses", () => {
    const decision = routeByFilename(
      "Acme x Meridian joint kickoff.docx",
      aliases
    );
    expect(decision.kind).toBe("unrouted");
    if (decision.kind === "unrouted") {
      expect(decision.reason).toBe("multiple_matches");
    }
  });
});

describe("contentHash", () => {
  it("is deterministic — same content yields same hash", () => {
    const a = contentHash("Alice: We agreed to ship by Friday.");
    const b = contentHash("Alice: We agreed to ship by Friday.");
    expect(a).toBe(b);
  });

  it("changes when content changes", () => {
    const a = contentHash("Alice: We agreed to ship by Friday.");
    const b = contentHash("Alice: We agreed to ship by Thursday.");
    expect(a).not.toBe(b);
  });
});
