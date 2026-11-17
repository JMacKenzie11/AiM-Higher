import { describe, it, expect } from "vitest";
import type { AttentionTrigger } from "./attention";
import {
  changeBetween,
  DAY_MS,
  daysAgoLabel,
  daysSince,
  dueThisWeekCount,
  durationMinutes,
  followThroughLine,
  ftrInWindow,
  ftrNowAndThen,
  leftOffLines,
  needsYouLine,
  needsYouReason,
  orderByAttention,
  oneSentenceSummary,
  overdueSince,
  prepareHref,
  priorityCounts,
  questionFor,
  sectionBody,
  shortDay,
  sinceDate,
  type FtrRow,
} from "./derive";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS).toISOString();
const kept = (n: number, status = "kept_on_time"): FtrRow => ({
  status,
  completed_at: daysAgo(n),
  deleted_at: null,
  parked_at: null,
});

describe("Follow-Through Rate now and four weeks ago", () => {
  it("counts on-time over everything resolved in the window", () => {
    const rows = [kept(1), kept(2), kept(3, "kept_late"), kept(4, "missed")];
    expect(ftrInWindow(rows, NOW - 30 * DAY_MS, NOW + 1)).toBe(50);
  });

  it("leaves out open, deleted and parked rows, and null when nothing resolved", () => {
    const rows: FtrRow[] = [
      { ...kept(1), deleted_at: daysAgo(0) },
      { ...kept(1), parked_at: daysAgo(0) },
      { status: "open", completed_at: null, deleted_at: null, parked_at: null },
    ];
    expect(ftrInWindow(rows, NOW - 30 * DAY_MS, NOW + 1)).toBeNull();
  });

  it("splits now (last 30 days) from then (the 30 days ending 28 days ago)", () => {
    // Now: 2 of 2 on time. Then (days 28 to 58 ago): 1 of 2.
    const rows = [kept(1), kept(10), kept(30), kept(40, "missed")];
    expect(ftrNowAndThen(rows, NOW)).toEqual({ now: 100, then: 50 });
  });

  it("gives then as null when there is no four-week-old data", () => {
    expect(ftrNowAndThen([kept(1)], NOW)).toEqual({ now: 100, then: null });
  });
});

describe("change against four weeks ago", () => {
  it("up, down and no change", () => {
    expect(changeBetween(60, 68)).toEqual({ direction: "up", amount: 8 });
    expect(changeBetween(81, 64)).toEqual({ direction: "down", amount: 17 });
    expect(changeBetween(71, 71)).toEqual({ direction: "same", amount: 0 });
  });

  it("rounds to the decimals asked, so 0.04 apart reads as no change on a /10 score", () => {
    expect(changeBetween(6.3, 6.7, 1)).toEqual({ direction: "up", amount: 0.4 });
    expect(changeBetween(6.31, 6.34, 1)).toEqual({ direction: "same", amount: 0 });
  });

  it("is null, so no arrow is drawn, when either side is missing", () => {
    expect(changeBetween(null, 5)).toBeNull();
    expect(changeBetween(5, null)).toBeNull();
  });
});

describe("priorities in the open quarter", () => {
  it("counts on track and overdue, leaving out complete and archived", () => {
    const rows = [
      { status: "on_track", due_date: "2026-12-01", archived: false },
      { status: "ongoing", due_date: null, archived: false },
      { status: "on_track", due_date: "2026-11-01", archived: false },
      { status: "behind", due_date: "2026-11-10", archived: false },
      { status: "complete", due_date: "2026-11-01", archived: false },
      { status: "on_track", due_date: "2026-11-01", archived: true },
      { status: "not_started", due_date: "2026-12-20", archived: false },
    ];
    expect(priorityCounts(rows, "2026-11-16")).toEqual({ onTrack: 2, overdue: 2 });
  });
});

describe("days ago", () => {
  it("counts whole days and says today and yesterday", () => {
    expect(daysSince(daysAgo(19), NOW)).toBe(19);
    expect(daysAgoLabel(0)).toBe("today");
    expect(daysAgoLabel(1)).toBe("yesterday");
    expect(daysAgoLabel(19)).toBe("19 days ago");
  });

  it("formats a short day in UTC", () => {
    expect(shortDay("2026-11-10T15:00:00Z")).toBe("Tue 10 Nov");
  });
});

describe("your commitments due this week", () => {
  it("counts open ones due by Friday, overdue included", () => {
    const rows = [
      { status: "open", due_date: "2026-11-10" },
      { status: "open", due_date: "2026-11-20" },
      { status: "open", due_date: "2026-11-27" },
      { status: "kept_on_time", due_date: "2026-11-18" },
      { status: "open", due_date: "2026-11-18", parked_at: "2026-11-15" },
      { status: "open", due_date: null },
    ];
    expect(dueThisWeekCount(rows, "2026-11-20")).toBe(2);
  });
});

describe("a question worth asking, per signal", () => {
  const triggers: AttentionTrigger[] = [
    { kind: "scorecard_dropped", from: 6.4, to: 5.8, priorDate: "2026-11-08" },
    { kind: "ftr_low", rate: 52, threshold: 60 },
    { kind: "ftr_declining", from: 81, to: 64 },
    { kind: "facilitation_low", overall: 4, meetingId: "m" },
    { kind: "facilitation_insufficient", meetingId: "m" },
    { kind: "priority_overdue", count: 2, oldestDays: 20 },
    { kind: "priority_overdue", count: 1, oldestDays: 20 },
    { kind: "unrouted_transcript", count: 1 },
  ];

  it("has a fixed question for every kind, built from strength", () => {
    for (const t of triggers) {
      const q = questionFor(t);
      expect(q.endsWith("?")).toBe(true);
      expect(q).not.toMatch(/—/);
    }
  });

  it("names the number the trend started from", () => {
    expect(questionFor({ kind: "ftr_declining", from: 81, to: 64 })).toBe(
      "What made the weeks at 81% work, and what changed?"
    );
    expect(questionFor({ kind: "priority_overdue", count: 2, oldestDays: 20 })).toBe(
      "Which of the overdue priorities still matters most this quarter?"
    );
  });
});

const ANALYSIS = `## Purpose of the Call
This call set out to cut **eight** priorities to three. Sam wants the Q4 wins to lead.

## Attendees
- Sam Patel
- Priya Shah

## Detailed Discussions
### A) Priorities
Long text.

## 6. Decisions Made (Summary Section)
**Confirmed directions:**
- Open the planning day with the two Q4 wins.
- Priya to be asked, not told, to own service calls.
1. Cut eight priorities to three before January.

## Core Values in Action
- Ownership.`;

describe("what a coaching call's analysis says", () => {
  it("finds a section, numbered or not", () => {
    expect(sectionBody(ANALYSIS, /^Attendees$/)).toBe("- Sam Patel\n- Priya Shah");
    expect(sectionBody(ANALYSIS, /^Decisions Made\b/)).toMatch(/^\*\*Confirmed directions/);
    expect(sectionBody(ANALYSIS, /^Nope$/)).toBeNull();
  });

  it("takes the first sentence of the Purpose of the Call, without markdown", () => {
    expect(oneSentenceSummary(ANALYSIS)).toBe("This call set out to cut eight priorities to three.");
  });

  it("falls back to the first paragraph when there is no purpose section", () => {
    expect(oneSentenceSummary("Lee wants field leads owning their numbers. More text.")).toBe(
      "Lee wants field leads owning their numbers."
    );
    expect(oneSentenceSummary(null)).toBeNull();
    expect(oneSentenceSummary("")).toBeNull();
  });

  it("shortens a sentence that runs on", () => {
    const long = `## Purpose of the Call\n${"word ".repeat(80)}end.`;
    const s = oneSentenceSummary(long) as string;
    expect(s.length).toBeLessThanOrEqual(220);
    expect(s.endsWith("...")).toBe(true);
  });

  it("reads the decisions, one per line, skipping lead-in labels", () => {
    expect(leftOffLines(ANALYSIS)).toEqual({
      kind: "decisions",
      lines: [
        "Open the planning day with the two Q4 wins.",
        "Priya to be asked, not told, to own service calls.",
        "Cut eight priorities to three before January.",
      ],
    });
  });

  it("falls back to the summary when the call recorded no decisions", () => {
    const md = "## Purpose of the Call\nA first conversation about the team.\n\n## Attendees\n- Lee";
    expect(leftOffLines(md)).toEqual({ kind: "summary", lines: ["A first conversation about the team."] });
    expect(leftOffLines(null)).toBeNull();
    expect(leftOffLines("## Attendees\n- Lee")).toBeNull();
  });
});

describe("how long a call ran", () => {
  it("reads the last timestamp", () => {
    expect(durationMinutes("00:00:05 Sam: hi\n00:47:40 Jason: bye")).toBe(48);
    expect(durationMinutes("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nhi\n\n00:31:02.500 --> 00:31:05.000\nbye")).toBe(31);
  });

  it("is null without timestamps or under a minute", () => {
    expect(durationMinutes("Sam: hi\nJason: bye")).toBeNull();
    expect(durationMinutes("00:00:20 Sam: hi")).toBeNull();
  });
});

describe("since your last call", () => {
  it("counts from the last call, or four weeks back when there is none", () => {
    expect(sinceDate("2026-11-12T15:00:00Z", NOW)).toEqual({ iso: "2026-11-12T15:00:00Z", fromCall: true });
    expect(sinceDate(null, NOW)).toEqual({ iso: daysAgo(28), fromCall: false });
  });

  it("finds the priorities that became overdue since then", () => {
    const rows = [
      { id: "a", status: "on_track", due_date: "2026-11-13", archived: false },
      { id: "b", status: "on_track", due_date: "2026-11-01", archived: false },
      { id: "c", status: "complete", due_date: "2026-11-14", archived: false },
      { id: "d", status: "on_track", due_date: "2026-11-20", archived: false },
      { id: "e", status: "behind", due_date: "2026-11-12", archived: false },
    ];
    expect(overdueSince(rows, "2026-11-12T15:00:00Z", "2026-11-16").map((p) => p.id)).toEqual(["a", "e"]);
  });

  it("says how follow-through moved", () => {
    expect(followThroughLine(74, 82)).toEqual({ tone: "up", text: "Follow-through up from 74% to 82%." });
    expect(followThroughLine(82, 74)).toEqual({ tone: "down", text: "Follow-through down from 82% to 74%." });
    expect(followThroughLine(80, 80)).toEqual({ tone: "same", text: "Follow-through held at 80%." });
    expect(followThroughLine(null, 80)).toEqual({ tone: "same", text: "Follow-through is 80%." });
    expect(followThroughLine(80, null)).toBeNull();
  });
});

describe("Prepare", () => {
  it("opens the Coaching calls tab on the company", () => {
    expect(prepareHref("abc")).toBe("/hq?company=abc#coaching-calls");
  });
});

describe("orderByAttention", () => {
  const rows = [
    { id: "a", name: "Acme" },
    { id: "b", name: "Bolt" },
    { id: "c", name: "Cobalt" },
    { id: "d", name: "Delta" },
  ];
  it("puts flagged companies first, heaviest first, then the rest by name", () => {
    const out = orderByAttention(rows, [
      { companyId: "d", severity: 2 },
      { companyId: "c", severity: 7 },
    ]);
    expect(out.map((r) => r.id)).toEqual(["c", "d", "a", "b"]);
  });
  it("breaks a severity tie by name", () => {
    const out = orderByAttention(rows, [
      { companyId: "d", severity: 3 },
      { companyId: "b", severity: 3 },
    ]);
    expect(out.map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  });
  it("is alphabetical with nobody flagged, and leaves the input alone", () => {
    const shuffled = [rows[2], rows[0], rows[3], rows[1]];
    expect(orderByAttention(shuffled, []).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(shuffled.map((r) => r.id)).toEqual(["c", "a", "d", "b"]);
  });
});

describe("needsYouReason / needsYouLine", () => {
  it("says each trigger in a few words", () => {
    const all: AttentionTrigger[] = [
      { kind: "scorecard_dropped", from: 6.2, to: 5.1, priorDate: "2026-10-01" },
      { kind: "ftr_low", rate: 41, threshold: 60 },
      { kind: "ftr_declining", from: 80, to: 70 },
      { kind: "facilitation_low", overall: 3, meetingId: "m" },
      { kind: "facilitation_insufficient", meetingId: "m" },
      { kind: "priority_overdue", count: 2, oldestDays: 30 },
      { kind: "priority_overdue", count: 1, oldestDays: 20 },
      { kind: "unrouted_transcript", count: 1 },
    ];
    expect(all.map(needsYouReason)).toEqual([
      "Scorecard down from 6.2 to 5.1",
      "Follow-through below 60%",
      "Follow-through falling",
      "Low facilitation score",
      "Last meeting couldn't be scored",
      "2 priorities over two weeks late",
      "1 priority over two weeks late",
      "1 recording waiting to be filed",
    ]);
    for (const line of all.map(needsYouReason)) expect(line).not.toMatch(/\u2014|\bAI\b/);
  });
  it("shows at most two reasons", () => {
    expect(
      needsYouLine([
        { kind: "ftr_low", rate: 41, threshold: 60 },
        { kind: "priority_overdue", count: 3, oldestDays: 30 },
        { kind: "unrouted_transcript", count: 2 },
      ])
    ).toBe("Follow-through below 60% · 3 priorities over two weeks late");
  });
});
