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
    });
  });
});
