import { describe, it, expect, vi } from "vitest";
import {
  escapeLike,
  isOffTarget,
  offTargetIssuePrefix,
  offTargetIssueTitle,
  raiseOffTargetIssue,
} from "./off-target";
import type { SupabaseClient } from "@supabase/supabase-js";

// The rule that turns an under-target value into an issue.
//
// Lives outside the cron on purpose: when HubSpot or any other system
// feeds a KPI, a value below target has to raise the same issue a
// hand-entered one does. Two callers, one rule.

const NUM = {
  id: "m_1",
  description: "On-time delivery",
  value_type: "number" as const,
  target_direction: "higher_is_better" as const,
};

// Records the filters as well as the inserts. The dedupe is the
// thing most likely to be wrong here and it is invisible unless the
// test can see what was actually asked of the database.
function fake(existing: Array<{ id: string }> = []) {
  const inserts: unknown[] = [];
  const filters: Array<{ op: string; column: string; value: unknown }> = [];
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push({ op: "eq", column, value });
      return builder;
    },
    like: (column: string, value: unknown) => {
      filters.push({ op: "like", column, value });
      return builder;
    },
    limit: async () => ({ data: existing }),
    insert: (payload: unknown) => {
      inserts.push(payload);
      return Promise.resolve({ error: null });
    },
  });
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, inserts, filters };
}

describe("isOffTarget", () => {
  it("is false when there is no target", () => {
    // Targets are optional on a CSF now, so no target is a normal
    // state and must never raise an issue.
    expect(
      isOffTarget({ ...NUM, target: null }, { number: 1, text: null })
    ).toBe(false);
  });

  it("is false when the target cannot be parsed", () => {
    expect(
      isOffTarget({ ...NUM, target: "soon" }, { number: 1, text: null })
    ).toBe(false);
  });

  it("is false when nothing was logged", () => {
    // Missing is a different problem with a different response. It
    // stays a commitment, not an issue.
    expect(
      isOffTarget({ ...NUM, target: "95" }, { number: null, text: null })
    ).toBe(false);
  });

  it("treats exactly on target as on target", () => {
    expect(
      isOffTarget({ ...NUM, target: "95" }, { number: 95, text: null })
    ).toBe(false);
  });

  it("catches under target when higher is better", () => {
    expect(
      isOffTarget({ ...NUM, target: "95" }, { number: 94, text: null })
    ).toBe(true);
  });

  it("flips for lower is better", () => {
    const low = { ...NUM, target_direction: "lower_is_better" as const };
    expect(isOffTarget({ ...low, target: "5" }, { number: 6, text: null })).toBe(
      true
    );
    expect(isOffTarget({ ...low, target: "5" }, { number: 4, text: null })).toBe(
      false
    );
  });

  it("compares text measures case-insensitively", () => {
    const txt = { ...NUM, value_type: "text" as const, target: "Yes" };
    expect(isOffTarget(txt, { number: null, text: " yes " })).toBe(false);
    expect(isOffTarget(txt, { number: null, text: "No" })).toBe(true);
    // Empty text is missing, not off.
    expect(isOffTarget(txt, { number: null, text: "  " })).toBe(false);
  });
});

describe("offTargetIssueTitle", () => {
  it("names the measure, the value and the target", () => {
    const title = offTargetIssueTitle(
      { ...NUM, target: "95", value_type: "percent" },
      { number: 88, text: null }
    );
    expect(title).toBe("Off target: On-time delivery (88% vs. target ≥ 95)");
  });
});

describe("raiseOffTargetIssue", () => {
  it("raises an issue for an under-target value", async () => {
    const { client, inserts } = fake();

    const res = await raiseOffTargetIssue(client, {
      companyId: "co_1",
      measure: { ...NUM, target: "95" },
      value: { number: 88, text: null },
    });

    expect(res.raised).toBe(true);
    expect(inserts[0]).toMatchObject({
      company_id: "co_1",
      status: "open",
      // Left blank on purpose: the desired outcome is the team's to
      // decide, and pre-filling makes the issue look already worked.
      desired_outcome: null,
    });
  });

  it("raises nothing when the value is on target", async () => {
    const { client, inserts } = fake();

    const res = await raiseOffTargetIssue(client, {
      companyId: "co_1",
      measure: { ...NUM, target: "95" },
      value: { number: 96, text: null },
    });

    expect(res.raised).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("does not stack a duplicate while one is already open", async () => {
    // The cron re-runs, or a sync writes the same value twice. Neither
    // should pile identical issues onto a leader's list.
    const { client, inserts } = fake([{ id: "existing" }]);

    const res = await raiseOffTargetIssue(client, {
      companyId: "co_1",
      measure: { ...NUM, target: "95" },
      value: { number: 88, text: null },
    });

    expect(res).toEqual({ raised: false, reason: "already open" });
    expect(inserts).toHaveLength(0);
  });

  it("records who triggered it when a person did", async () => {
    // Null for a system sweep, set when an entry someone typed caused
    // it. An integration passes null too.
    const { client, inserts } = fake();

    await raiseOffTargetIssue(client, {
      companyId: "co_1",
      measure: { ...NUM, target: "95" },
      value: { number: 88, text: null },
      createdBy: "u_1",
    });

    expect(inserts[0]).toMatchObject({ created_by: "u_1" });
  });

  // ---- One open issue per MEASURE, not per value ---------------
  //
  // The title carries the value, which reads well and dedupes badly.
  // Keyed on the whole title, a measure that stays off target with a
  // drifting number raises a new issue every week: 42, then 40, then
  // 41, three issues about one problem. Ten struggling measures
  // becomes ten new issues a week, forever.
  it("matches on the measure, not on the exact value", async () => {
    const { client, filters } = fake();

    await raiseOffTargetIssue(client, {
      companyId: "co_1",
      measure: { ...NUM, target: "95" },
      value: { number: 88, text: null },
    });

    const like = filters.find((f) => f.op === "like");
    expect(like?.column).toBe("title");
    // The prefix stops before the value, so next week's different
    // number still matches this week's open issue.
    expect(like?.value).toBe("Off target: On-time delivery (%");
    expect(filters.some((f) => f.column === "title" && f.op === "eq")).toBe(
      false
    );
  });

  it("raises nothing next week when the number has moved but is still bad", async () => {
    const { client, inserts } = fake([{ id: "raised-last-week" }]);

    const res = await raiseOffTargetIssue(client, {
      companyId: "co_1",
      measure: { ...NUM, target: "95" },
      // A different value from whatever opened the standing issue.
      value: { number: 71, text: null },
    });

    expect(res).toEqual({ raised: false, reason: "already open" });
    expect(inserts).toHaveLength(0);
  });

  it("only ever looks at OPEN issues", async () => {
    // Resolved last month and gone off target again is a NEW problem
    // and deserves a new issue. That is the one case where a second
    // issue about one measure is right.
    const { client, filters } = fake();

    await raiseOffTargetIssue(client, {
      companyId: "co_1",
      measure: { ...NUM, target: "95" },
      value: { number: 88, text: null },
    });

    expect(filters).toContainEqual({
      op: "eq",
      column: "status",
      value: "open",
    });
  });

  it("stays inside the company", async () => {
    const { client, filters } = fake();

    await raiseOffTargetIssue(client, {
      companyId: "co_1",
      measure: { ...NUM, target: "95" },
      value: { number: 88, text: null },
    });

    expect(filters).toContainEqual({
      op: "eq",
      column: "company_id",
      value: "co_1",
    });
  });
});

describe("offTargetIssuePrefix", () => {
  it("stops before the value", () => {
    expect(offTargetIssuePrefix({ ...NUM, target: "95" })).toBe(
      "Off target: On-time delivery ("
    );
  });

  it("is the start of the title it is meant to match", () => {
    const measure = { ...NUM, target: "95" };
    const title = offTargetIssueTitle(measure, { number: 88, text: null });
    expect(title.startsWith(offTargetIssuePrefix(measure))).toBe(true);
  });
});

describe("escapeLike", () => {
  it("escapes the wildcards, because measure names contain them", () => {
    // "Win % by region" is not hypothetical. Unescaped, its prefix
    // would match open issues belonging to OTHER measures and
    // silently suppress them — a bug that only shows up for companies
    // whose measure names happen to contain punctuation.
    expect(escapeLike("Win % by region")).toBe("Win \\% by region");
    expect(escapeLike("cost_per_unit")).toBe("cost\\_per\\_unit");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("leaves an ordinary name alone", () => {
    expect(escapeLike("On-time delivery")).toBe("On-time delivery");
  });
});
