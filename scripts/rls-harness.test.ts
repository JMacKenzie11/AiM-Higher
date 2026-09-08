import { describe, it, expect } from "vitest";
import {
  projectRef,
  summaryLines,
  parseArgs,
  type CaseResult,
} from "./rls-harness.ts";

// The pure halves of the RLS harness. The cases themselves need a real
// Postgres and are run by name (`npm run rls:hazards`), reported in the
// PR body rather than gated in CI — see the header of rls-harness.ts.
//
// Importing this file is itself a test of the entry-point guard: the
// harness creates tables and policies, and without the guard this
// import would run it. scripts/entry-points.test.ts is the gate.

describe("projectRef", () => {
  it("extracts the ref from a Supabase URL", () => {
    expect(projectRef("https://abcdefghijkl.supabase.co")).toBe("abcdefghijkl");
  });

  it("returns null for anything else, so the caller refuses rather than guesses", () => {
    expect(projectRef(undefined)).toBeNull();
    expect(projectRef("")).toBeNull();
    expect(projectRef("postgresql://host/db")).toBeNull();
    expect(projectRef("https://example.com")).toBeNull();
  });
});

describe("parseArgs", () => {
  it("runs every case and skips the measurement by default", () => {
    expect(parseArgs([])).toEqual({ only: null, explain: false });
  });

  it("reads --case and --explain", () => {
    expect(parseArgs(["--case", "hazard-1", "--explain"])).toEqual({
      only: "hazard-1",
      explain: true,
    });
  });

  it("rejects an unknown option rather than ignoring it", () => {
    expect(() => parseArgs(["--cases"])).toThrow();
  });
});

describe("summaryLines", () => {
  const pass: CaseResult = {
    name: "hazard-1 null-company",
    hazard: "IS NOT DISTINCT FROM matches NULL to NULL",
    wrong: "1 row(s) visible",
    right: "0 row(s) visible",
    ok: true,
    detail: "wrong shape leaks, right shape denies",
  };

  it("shows both shapes on every case, not just the verdict", () => {
    // A case that reported only PASS would hide the thing that makes it
    // meaningful: that the deliberately-wrong policy actually leaked.
    // If the wrong shape ever stops leaking, the case has stopped
    // testing anything and the reader has to be able to see it.
    const out = summaryLines([pass]).join("\n");
    expect(out).toContain("wrong shape: 1 row(s) visible");
    expect(out).toContain("right shape: 0 row(s) visible");
  });

  it("counts passes and failures", () => {
    const out = summaryLines([pass, { ...pass, ok: false }]).join("\n");
    expect(out).toContain("2 cases: 1 pass, 1 fail");
  });
});
