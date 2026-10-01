import { describe, expect, it } from "vitest";
import { reportLines, ruleLines, ruleWeeks, topRules, weekOf, weeklyRows, type RuleBreak } from "./aimee-uptake";

describe("aimee:uptake", () => {
  it("puts a timestamp in the week starting that Monday", () => {
    expect(weekOf("2026-09-28T10:00:00Z")).toBe("2026-09-28"); // a Monday
    expect(weekOf("2026-10-04T23:59:00Z")).toBe("2026-09-28"); // the Sunday after
    expect(weekOf("2026-10-05T00:00:00Z")).toBe("2026-10-05");
  });

  it("counts opens, conversations, messages, help and its misses, and the move to the page", () => {
    const rows = weeklyRows(
      [
        { company_id: "c1", kind: "opened", found: null, created_at: "2026-09-28T09:00:00Z" },
        { company_id: "c1", kind: "opened", found: null, created_at: "2026-09-29T09:00:00Z" },
        { company_id: "c1", kind: "help_search", found: true, created_at: "2026-09-29T09:01:00Z" },
        { company_id: "c1", kind: "help_search", found: false, created_at: "2026-09-29T09:02:00Z" },
        { company_id: "c1", kind: "continue_on_page", found: null, created_at: "2026-09-29T09:03:00Z" },
      ],
      [{ id: "p1", company_id: "c1", created_at: "2026-09-28T09:00:00Z" }],
      [
        { conversation_id: "p1", created_at: "2026-09-28T09:01:00Z" },
        { conversation_id: "p1", created_at: "2026-09-29T09:01:00Z" },
        // Not a panel conversation: not counted.
        { conversation_id: "elsewhere", created_at: "2026-09-29T09:01:00Z" },
      ]
    );
    expect(rows).toEqual([
      { week: "2026-09-28", company_id: "c1", opens: 2, convos: 1, messages: 2, help: 2, noResult: 1, toPage: 1 },
    ]);
    const lines = reportLines(rows, new Map([["c1", "Acme"]]));
    expect(lines.at(-1)).toBe("  2 help searches, 1 with no result (50%)");
    expect(lines[1]).toContain("Acme");
  });

  it("says so in words when there is nothing", () => {
    expect(reportLines([], new Map())).toEqual(["  No panel use or help searches in this window on this instance."]);
  });
});

describe("voice rules still broken when shown", () => {
  const breaks: RuleBreak[] = [
    { surface: "debrief_reply", origin: null, rules: ["the room", "invented quote"], created_at: "2026-09-29T10:00:00Z" },
    { surface: "conversation", origin: "panel", rules: ["the room"], created_at: "2026-09-30T10:00:00Z" },
    { surface: "conversation", origin: "page", rules: ["X instead of Y"], created_at: "2026-09-22T10:00:00Z" },
  ];
  const replies = new Map([["2026-09-28", 40], ["2026-09-21", 12]]);

  it("counts each surface per week against every reply that week", () => {
    expect(ruleWeeks(breaks, replies)).toEqual([
      { week: "2026-09-28", replies: 40, debrief: 1, opener: 0, page: 0, panel: 1 },
      { week: "2026-09-21", replies: 12, debrief: 0, opener: 0, page: 1, panel: 0 },
    ]);
  });

  it("names the rules most often broken", () => {
    expect(topRules(breaks)).toEqual([["the room", 2], ["invented quote", 1], ["X instead of Y", 1]]);
    expect(ruleLines(ruleWeeks(breaks, replies), breaks).at(-1)).toBe(
      "  Most often: the room (2), invented quote (1), X instead of Y (1)"
    );
  });

  it("says so when nothing was broken", () => {
    expect(ruleLines(ruleWeeks([], replies), []).at(-1)).toBe("  None broken.");
  });
});
