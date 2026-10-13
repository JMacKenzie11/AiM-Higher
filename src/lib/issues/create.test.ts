import { describe, it, expect, beforeEach, vi } from "vitest";

// insertIssue: the rules and the write, on a client it is handed. The
// Issues page's own form tests live in actions.test.ts.

const mocks = vi.hoisted(() => {
  const inserted: Array<Record<string, unknown>> = [];
  const topRank = vi.fn();
  const client = {
    from: (table: string) => {
      if (table !== "issues") throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: topRank }) }) }) }) }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "i_new", ...row }, error: null }) }) };
        },
      };
    },
  };
  return { inserted, topRank, client };
});

vi.mock("server-only", () => ({}));

import { insertIssue } from "./create";

const writer = { db: mocks.client, profile: { id: "u_me", role: "team_member", company_id: "co_acme" } } as never;

beforeEach(() => {
  mocks.inserted.length = 0;
  mocks.topRank.mockResolvedValue({ data: { rank: 4 } });
});

describe("insertIssue", () => {
  it("raises it in the company it is told, at the bottom of the open list, as the caller", async () => {
    const r = await insertIssue(writer, "co_acme", { title: "  Quotes go out late  ", desiredOutcome: " " });
    expect(r.ok).toBe(true);
    expect(mocks.inserted[0]).toEqual({
      company_id: "co_acme",
      title: "Quotes go out late",
      desired_outcome: null,
      rank: 5,
      source_meeting_id: null,
      created_by: "u_me",
    });
  });

  it("refuses an empty title, a long one, and no company", async () => {
    expect(await insertIssue(writer, "co_acme", { title: " " })).toEqual({ ok: false, message: "Name the issue plainly." });
    expect(await insertIssue(writer, "co_acme", { title: "x".repeat(201) })).toEqual({
      ok: false,
      message: "Keep the issue title under 200 characters.",
    });
    expect(await insertIssue(writer, null, { title: "Quotes go out late" })).toEqual({
      ok: false,
      message: "Pick a company scope first.",
    });
    expect(mocks.inserted).toEqual([]);
  });
});
