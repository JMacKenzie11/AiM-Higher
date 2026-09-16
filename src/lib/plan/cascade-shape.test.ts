import { describe, it, expect } from "vitest";
import { bucketCascadeChildren } from "./cascade-shape";

// Where each row of the cascade renders. Three rules, and the third
// is a bug fix rather than a new feature — see rule 3 below.

const sfa = (id: string) => ({ id });
const goal = (id: string, sfa_id: string | null) => ({ id, sfa_id });
const priority = (
  id: string,
  annual_goal_id: string | null,
  sfa_id: string | null = null
) => ({ id, annual_goal_id, sfa_id });

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);

describe("bucketCascadeChildren", () => {
  it("puts a priority under its goal, and its goal under the focus area", () => {
    const out = bucketCascadeChildren(
      [sfa("s1")],
      [goal("g1", "s1")],
      [priority("p1", "g1")]
    );

    expect(ids(out.goalsBySfa.get("s1") ?? [])).toEqual(["g1"]);
    expect(ids(out.prioritiesByGoal.get("g1") ?? [])).toEqual(["p1"]);
    expect(out.orphanGoals).toEqual([]);
    expect(out.orphanPriorities).toEqual([]);
  });

  it("puts a priority with no goal under its focus area", () => {
    // The whole point of migration 0209: a focus area whose life is
    // one quarter holds its priorities directly.
    const out = bucketCascadeChildren(
      [sfa("s1")],
      [],
      [priority("p1", null, "s1")]
    );

    expect(ids(out.prioritiesBySfa.get("s1") ?? [])).toEqual(["p1"]);
    expect(out.orphanPriorities).toEqual([]);
  });

  it("holds goals and direct priorities under the same focus area", () => {
    // Both at once is the normal case, not an edge: a focus area may
    // hold goals, priorities, or both.
    const out = bucketCascadeChildren(
      [sfa("s1")],
      [goal("g1", "s1")],
      [priority("p1", "g1"), priority("p2", null, "s1")]
    );

    expect(ids(out.goalsBySfa.get("s1") ?? [])).toEqual(["g1"]);
    expect(ids(out.prioritiesBySfa.get("s1") ?? [])).toEqual(["p2"]);
    expect(ids(out.prioritiesByGoal.get("g1") ?? [])).toEqual(["p1"]);
  });

  it("renders a two-parent row once, under its goal", () => {
    // `priorities_parent_exclusive` makes this impossible in the
    // database. The rule is here so that a stale object in memory
    // renders once rather than in two places at the same indent.
    const out = bucketCascadeChildren(
      [sfa("s1")],
      [goal("g1", "s1")],
      [priority("p1", "g1", "s1")]
    );

    expect(ids(out.prioritiesByGoal.get("g1") ?? [])).toEqual(["p1"]);
    expect(out.prioritiesBySfa.get("s1")).toBeUndefined();
  });

  // ---- Rule 3: a parent that is off screen -----------------------
  // Archived rows are excluded by the queries, so a child can point
  // at a parent that is not in either list. It used to render
  // NOWHERE: not under a parent, and not in the standalone sections
  // either, because those were "parent column is null" rather than
  // "nowhere to put it". Archiving one focus area from its detail
  // page made its goals vanish from /plan, which reads as deletion.

  it("treats a goal whose focus area is off screen as standalone", () => {
    const out = bucketCascadeChildren([], [goal("g1", "s_archived")], []);

    expect(ids(out.orphanGoals)).toEqual(["g1"]);
  });

  it("treats a priority whose focus area is off screen as standalone", () => {
    const out = bucketCascadeChildren(
      [],
      [],
      [priority("p1", null, "s_archived")]
    );

    expect(ids(out.orphanPriorities)).toEqual(["p1"]);
  });

  it("treats a priority whose goal is off screen as standalone", () => {
    const out = bucketCascadeChildren([sfa("s1")], [], [priority("p1", "g_archived")]);

    expect(ids(out.orphanPriorities)).toEqual(["p1"]);
  });

  it("keeps a genuinely unparented row standalone", () => {
    const out = bucketCascadeChildren([], [goal("g1", null)], [priority("p1", null)]);

    expect(ids(out.orphanGoals)).toEqual(["g1"]);
    expect(ids(out.orphanPriorities)).toEqual(["p1"]);
  });

  it("never renders a row twice or drops one", () => {
    // The invariant behind all of the above: every input appears in
    // exactly one bucket.
    const goals = [goal("g1", "s1"), goal("g2", null), goal("g3", "s_gone")];
    const priorities = [
      priority("p1", "g1"),
      priority("p2", null, "s1"),
      priority("p3", null, null),
      priority("p4", "g_gone"),
      priority("p5", null, "s_gone"),
    ];
    const out = bucketCascadeChildren([sfa("s1")], goals, priorities);

    const placedGoals = [
      ...[...out.goalsBySfa.values()].flat(),
      ...out.orphanGoals,
    ];
    const placedPriorities = [
      ...[...out.prioritiesByGoal.values()].flat(),
      ...[...out.prioritiesBySfa.values()].flat(),
      ...out.orphanPriorities,
    ];

    expect(ids(placedGoals).sort()).toEqual(ids(goals).sort());
    expect(ids(placedPriorities).sort()).toEqual(ids(priorities).sort());
  });
});
