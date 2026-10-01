import { describe, it, expect } from "vitest";
import { cleanMeetingTitle, meetingDayLabel, meetingLabel } from "./meeting-label";

// The real titles on dev, 2026-09-29.
describe("cleanMeetingTitle", () => {
  it.each([
    ["2026 09 10   Weekly Leadership Meeting (Geo Sci)", "Weekly Leadership Meeting"],
    ["2026 09 09   B&B Weekly Meeting   AiMS", "B&B Weekly Meeting AiMS"],
    ["07 24 Centre North Weekly AiMS Meeting", "Centre North Weekly AiMS Meeting"],
    ["Benson Weekly Leadership Meeting", "Benson Weekly Leadership Meeting"],
    ["Weekly Leadership Meeting - Sep 29, 2026", "Weekly Leadership Meeting"],
    ["Leadership sync [recording] 2026-09-29", "Leadership sync"],
  ])("%s", (raw, clean) => {
    expect(cleanMeetingTitle(raw)).toBe(clean);
  });

  it("is empty when only a date and brackets were there", () => {
    expect(cleanMeetingTitle("2026 09 10 (Geo Sci)")).toBe("");
    expect(cleanMeetingTitle(null)).toBe("");
  });
});

describe("meetingLabel", () => {
  it("is the cleaned name and the day", () => {
    expect(meetingLabel("2026 09 10   Weekly Leadership Meeting (Geo Sci)", "2026-09-10")).toBe(
      "Weekly Leadership Meeting, Thursday Sep 10"
    );
  });

  it("says Leadership meeting when the name cleans away to nothing", () => {
    expect(meetingLabel("2026 09 29", "2026-09-29")).toBe("Leadership meeting, Tuesday Sep 29");
  });

  it("reads the date as a calendar day, never shifted", () => {
    expect(meetingDayLabel("2026-09-08")).toBe("Tuesday Sep 8");
    expect(meetingDayLabel("2026-09-08T23:30:00-06:00")).toBe("Tuesday Sep 8");
  });
});
