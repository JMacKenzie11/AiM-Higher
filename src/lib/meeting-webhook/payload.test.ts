import { describe, expect, it } from "vitest";
import { MEETING_READY_EVENT, meetingReadyPayload, webhookConfig } from "./payload";

describe("webhookConfig", () => {
  it("is off without a URL", () => {
    expect(webhookConfig({})).toBeNull();
    expect(webhookConfig({ MEETING_READY_WEBHOOK_URL: "  " })).toBeNull();
  });
  it("carries the header when both name and key are set", () => {
    expect(
      webhookConfig({
        MEETING_READY_WEBHOOK_URL: "https://hook.example/x",
        MEETING_READY_WEBHOOK_HEADER: "Authorization",
        MEETING_READY_WEBHOOK_KEY: "Bearer k",
      })
    ).toEqual({ url: "https://hook.example/x", header: { name: "Authorization", value: "Bearer k" } });
  });
  it("sends no half header", () => {
    expect(
      webhookConfig({ MEETING_READY_WEBHOOK_URL: "https://hook.example/x", MEETING_READY_WEBHOOK_HEADER: "x-key" })
    ).toEqual({ url: "https://hook.example/x", header: null });
  });
});

describe("meetingReadyPayload", () => {
  it("names the meeting and links its page", () => {
    const p = meetingReadyPayload({
      meetingId: "m1",
      companyId: "c1",
      companyName: "Northside Plumbing",
      meetingTitle: "Weekly",
      meetingDateIso: "2026-11-19",
      origin: "https://www.aims-hq.com",
      now: new Date("2026-11-19T15:00:00Z"),
    });
    expect(p).toEqual({
      event: MEETING_READY_EVENT,
      meeting_id: "m1",
      company_id: "c1",
      company_name: "Northside Plumbing",
      meeting_title: "Weekly",
      meeting_date: "2026-11-19",
      meeting_url: "https://www.aims-hq.com/leadership/meetings/m1",
      analyzed_at: "2026-11-19T15:00:00.000Z",
      score: null,
    });
  });

  it("carries the rubric score's wording for the score video, never the quoted moments", () => {
    const check = (id: string, text: string, moment: string | null) => ({
      id, level: 3, source: "judge" as const, met: true, na: false, text, moment, agreed: 3, runs: 3,
    });
    const p = meetingReadyPayload({
      meetingId: "m1",
      companyId: "c1",
      companyName: "Northside Plumbing",
      meetingTitle: "Weekly",
      meetingDateIso: "2026-11-19",
      origin: "https://www.aims-hq.com",
      rubric: {
        version: 1,
        total: 38,
        outOfTen: "7.6",
        value: 7.6,
        parts: [
          { key: "checkin", name: "Positive check-in", level: 5, wins: [check("a", "Everyone shared a check-in (6 of 6)", "thanks everyone for a big week")], better: [] },
          { key: "data", name: "Critical Success Factors and data", level: 2, wins: [], better: [check("b", "Walk every measure on the scorecard (8 of 12 came up this week).", null)] },
        ],
        checks: [],
        talk: { attendees: 6, engaged: 5, topShare: 0.34 },
        readings: 3,
      },
    });
    expect(p.score).toEqual({
      out_of_ten: "7.6",
      total: 38,
      out_of: 50,
      try_next_week: { step: "Walk every measure on the scorecard.", part: "Critical Success Factors and data" },
      parts: [
        { name: "Positive check-in", level: 5, went_well: ["Everyone shared a check-in (6 of 6)"], even_better: [] },
        { name: "Critical Success Factors and data", level: 2, went_well: [], even_better: ["Walk every measure on the scorecard (8 of 12 came up this week)."] },
      ],
      set_video_with: "set_meeting_score_video",
    });
    expect(JSON.stringify(p)).not.toContain("thanks everyone for a big week");
  });
});
