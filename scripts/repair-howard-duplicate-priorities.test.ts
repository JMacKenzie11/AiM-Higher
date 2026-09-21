import { describe, it, expect } from "vitest";
import {
  planFor,
  parseArgs,
  type Candidate,
} from "./repair-howard-duplicate-priorities.ts";

// The decision, without a database. Everything dangerous about this
// script is in planFor.

const c = (over: Partial<Candidate> & { id: string }): Candidate => ({
  title: "Something",
  copies: 0,
  linked: 0,
  ...over,
});

describe("planFor", () => {
  it("deletes a row whose text survives as a commitment", () => {
    const plan = planFor([c({ id: "dupe", copies: 1 })]);
    expect(plan.deletable.map((x) => x.id)).toEqual(["dupe"]);
  });

  it("keeps a row whose text exists nowhere else", () => {
    // Deleting this destroys the only copy of the work.
    const plan = planFor([c({ id: "only", copies: 0 })]);
    expect(plan.deletable).toEqual([]);
    expect(plan.kept.map((x) => x.id)).toEqual(["only"]);
  });

  it("NEVER deletes a row with commitments hanging off it", () => {
    // commitments.priority_id is ON DELETE SET NULL, so deleting one
    // of these would silently unlink somebody's work rather than
    // failing. This is the guard that stops that.
    const plan = planFor([c({ id: "used", copies: 5, linked: 2 })]);
    expect(plan.deletable).toEqual([]);
    expect(plan.kept.map((x) => x.id)).toEqual(["used"]);
  });

  it("does not relax that guard under --include-unbacked", () => {
    const plan = planFor([c({ id: "used", copies: 0, linked: 1 })], {
      includeUnbacked: true,
    });
    expect(plan.deletable).toEqual([]);
  });

  it("--include-unbacked takes the rows with no commitment copy", () => {
    const plan = planFor(
      [c({ id: "a", copies: 0 }), c({ id: "b", copies: 1 })],
      { includeUnbacked: true }
    );
    expect(plan.deletable.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("is idempotent — a cleaned goal plans no further work", () => {
    expect(planFor([]).deletable).toEqual([]);
  });

  it("matches what was actually run on production", () => {
    // 16 rows under the goal: 14 with a commitment copy, 2 without,
    // none with commitments linked. The default run took 14; the
    // second run, on Jason's say-so, took the other 2.
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => c({ id: `d${i}`, copies: 1 })),
      c({ id: "u1" }),
      c({ id: "u2" }),
    ];
    expect(planFor(rows).deletable).toHaveLength(14);
    expect(planFor(rows).kept).toHaveLength(2);
    expect(planFor(rows, { includeUnbacked: true }).deletable).toHaveLength(16);
  });
});

describe("parseArgs", () => {
  it("defaults to writing, and to leaving unbacked rows alone", () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      yes: false,
      includeUnbacked: false,
    });
  });

  it("reads the flags", () => {
    expect(parseArgs(["--dry-run", "--yes", "--include-unbacked"])).toEqual({
      dryRun: true,
      yes: true,
      includeUnbacked: true,
    });
  });
});
