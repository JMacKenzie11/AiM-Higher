import { describe, it, expect } from "vitest";
import { canUploadTranscript, meetingInstant, uploadFileId, uploadTitle } from "./upload";

describe("uploadFileId", () => {
  it("prefixes the hash", () => {
    expect(uploadFileId("abc")).toBe("upload:abc");
  });
});

describe("canUploadTranscript", () => {
  it("admits people who manage meetings, and the champion", () => {
    expect(canUploadTranscript({ managesMeetings: true, isChampion: false })).toBe(true);
    expect(canUploadTranscript({ managesMeetings: false, isChampion: true })).toBe(true);
  });
  it("refuses everyone else", () => {
    expect(canUploadTranscript({ managesMeetings: false, isChampion: false })).toBe(false);
  });
});

describe("uploadTitle", () => {
  const base = { typed: "", firstLine: null, fileTitle: null, meetingDate: "2026-11-12" };
  it("prefers what was typed", () => {
    expect(uploadTitle({ ...base, typed: " Weekly ", firstLine: "Other" })).toBe("Weekly");
  });
  it("uses a heading-like first line", () => {
    expect(uploadTitle({ ...base, firstLine: "11-12 Weekly Meeting: Project Updates" })).toBe(
      "11-12 Weekly Meeting: Project Updates"
    );
  });
  it("skips a first line that is a timestamped turn", () => {
    expect(uploadTitle({ ...base, firstLine: "00:00:04 Speaker 1 hello", fileTitle: "weekly" })).toBe("weekly");
  });
  it("falls back to the date", () => {
    expect(uploadTitle(base)).toBe("Meeting on 2026-11-12");
  });
});

describe("meetingInstant", () => {
  const now = new Date("2026-11-13T15:00:00Z"); // 10:00 in New York
  it("today is now", () => {
    expect(meetingInstant("2026-11-13", "America/New_York", now)).toBe(now.toISOString());
  });
  it("an earlier day is noon there", () => {
    expect(meetingInstant("2026-11-12", "America/New_York", now)).toBe("2026-11-12T17:00:00.000Z");
    expect(meetingInstant("2026-07-01", "America/New_York", now)).toBe("2026-07-01T16:00:00.000Z");
  });
  it("uses the company's today, not UTC's", () => {
    const lateEvening = new Date("2026-11-14T02:00:00Z"); // 21:00 on the 13th in New York
    expect(meetingInstant("2026-11-14", "America/New_York", lateEvening)).toBeNull();
    expect(meetingInstant("2026-11-13", "America/New_York", lateEvening)).toBe(lateEvening.toISOString());
  });
  it("refuses the future and non-dates", () => {
    expect(meetingInstant("2026-11-20", "America/New_York", now)).toBeNull();
    expect(meetingInstant("yesterday", "America/New_York", now)).toBeNull();
  });
});
