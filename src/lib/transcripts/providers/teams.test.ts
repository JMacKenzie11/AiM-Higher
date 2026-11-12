import { describe, it, expect } from "vitest";
import { meetingChoices, newSince, transcriptName } from "./teams";

describe("newSince", () => {
  const t = (id: string, created: string) => ({ id, createdDateTime: created });

  it("takes only transcripts made after the cursor, oldest first", () => {
    const out = newSince(
      [t("c", "2026-11-12T16:00:00Z"), t("a", "2026-11-05T16:00:00Z"), t("b", "2026-11-11T16:00:00Z")],
      "2026-11-06T00:00:00Z"
    );
    expect(out.fresh.map((x) => x.id)).toEqual(["b", "c"]);
    expect(out.nextCursor).toBe("2026-11-12T16:00:00Z");
  });

  it("keeps the cursor where it was when nothing is new", () => {
    const out = newSince([t("a", "2026-11-05T16:00:00Z")], "2026-11-06T00:00:00Z");
    expect(out.fresh).toEqual([]);
    expect(out.nextCursor).toBe("2026-11-06T00:00:00Z");
  });
});

describe("transcriptName", () => {
  it("reads like a meeting title, with the day", () => {
    expect(transcriptName("Weekly Leadership", "2026-11-11T16:03:00Z")).toBe("Weekly Leadership 2026-11-11.vtt");
    expect(transcriptName(null, "2026-11-11T16:03:00Z")).toBe("Teams meeting 2026-11-11.vtt");
  });
});

describe("meetingChoices", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const weekly = (start: string) => ({
    subject: "Weekly Leadership",
    type: "occurrence",
    seriesMasterId: "series-1",
    isOnlineMeeting: true,
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/weekly" },
    start: { dateTime: start, timeZone: "UTC" },
  });

  it("shows a weekly meeting once, with its next date, ahead of one-off meetings", () => {
    const out = meetingChoices(
      [
        {
          subject: "Board review",
          type: "singleInstance",
          isOnlineMeeting: true,
          onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/board" },
          start: { dateTime: "2026-11-20T15:00:00.0000000", timeZone: "UTC" },
        },
        weekly("2026-11-04T16:00:00.0000000"),
        weekly("2026-11-11T16:00:00.0000000"),
        weekly("2026-11-18T16:00:00.0000000"),
      ],
      now
    );
    expect(out.map((m) => m.subject)).toEqual(["Weekly Leadership", "Board review"]);
    expect(out[0]).toMatchObject({ recurring: true, nextOrLast: "2026-11-18T16:00:00.000Z" });
    expect(out[1]).toMatchObject({ recurring: false });
  });

  it("leaves out calendar entries that are not Teams meetings", () => {
    const out = meetingChoices(
      [{ subject: "Lunch", type: "singleInstance", isOnlineMeeting: false, start: { dateTime: "2026-11-13T12:00:00" } }],
      now
    );
    expect(out).toEqual([]);
  });
});
