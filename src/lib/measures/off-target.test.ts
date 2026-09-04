import { describe, it, expect, vi } from "vitest";
import {
  isOffTarget,
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

function fake(existing: { id: string } | null = null) {
  const inserts: unknown[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: existing }) }),
          }),
        }),
      }),
      insert: (payload: unknown) => {
        inserts.push(payload);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserts };
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
    const { client, inserts } = fake({ id: "existing" });

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
});
