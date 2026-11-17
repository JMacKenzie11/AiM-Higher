import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email", () => ({ sendEmails: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ APP_URL: () => "http://localhost:3200" }));

import { sendWeeklyMeetingEmail, weeklyEmailOn } from "./send";

describe("the weekly meeting email switch", () => {
  it("is on only when WEEKLY_MEETING_EMAIL is exactly on", () => {
    expect(weeklyEmailOn(undefined)).toBe(false);
    expect(weeklyEmailOn("")).toBe(false);
    expect(weeklyEmailOn("off")).toBe(false);
    expect(weeklyEmailOn("on")).toBe(true);
  });

  it("switched off, touches nothing and sends nothing", async () => {
    vi.stubEnv("WEEKLY_MEETING_EMAIL", "");
    const admin = { from: vi.fn(), auth: { admin: { getUserById: vi.fn() } } };
    const result = await sendWeeklyMeetingEmail(admin as never, {
      meetingId: "m",
      companyId: "c",
      companyName: "Co",
      timezone: "UTC",
      meetingDateIso: "2026-11-17",
      subdomain: "@",
    });
    expect(result).toEqual({ skipped: expect.stringContaining("switched off") });
    expect(admin.from).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
