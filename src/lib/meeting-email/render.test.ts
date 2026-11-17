import { describe, expect, it } from "vitest";
import {
  groupCommitments,
  longDate,
  previewText,
  renderWeeklyMeetingEmail,
  type EmailCommitment,
} from "./render";

const CO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const M = "meeting-1";
const people = [
  { id: "dana", full_name: "Dana Lee" },
  { id: "marcus", full_name: "Marcus Webb" },
  { id: "coach", full_name: "Casey Coach" },
];
function c(id: string, owner: string | null, due: string, extra: Partial<EmailCommitment> = {}): EmailCommitment {
  return { id, company_id: CO, issue_id: null, owner_id: owner, description: `Do ${id}`, due_date: due, source_meeting_id: null, ...extra };
}
const TODAY = "2026-11-17";

describe("groupCommitments", () => {
  const groups = groupCommitments(
    [
      c("m1", "marcus", "2026-11-20"),
      c("d1", "dana", "2026-11-20", { source_meeting_id: M }),
      c("d2", "dana", "2026-11-16"),
      c("d3", "dana", "2026-11-18"),
      c("u1", null, "2026-11-19"),
      c("x1", "someone-gone", "2026-11-19"),
    ],
    people,
    M,
    TODAY
  );

  it("groups by person, by name, with nobody's last", () => {
    expect(groups.map((g) => g.name)).toEqual(["Dana Lee", "Marcus Webb", "Not assigned yet"]);
  });

  it("puts late ones first in each person's list, then by due date", () => {
    expect(groups[0].items.map((i) => i.id)).toEqual(["d2", "d3", "d1"]);
    expect(groups[0].items[0].late).toBe(true);
  });

  it("marks the ones agreed in this meeting as new", () => {
    expect(groups[0].items.find((i) => i.id === "d1")?.isNew).toBe(true);
    expect(groups[0].items.find((i) => i.id === "d3")?.isNew).toBe(false);
  });

  it("files an owner it cannot name under nobody's", () => {
    expect(groups[2].items.map((i) => i.id)).toEqual(["u1", "x1"]);
  });
});

describe("renderWeeklyMeetingEmail", () => {
  const groups = groupCommitments(
    [c("m1", "marcus", "2026-11-20", { source_meeting_id: M }), c("d1", "dana", "2026-11-16", { issue_id: "iss" })],
    people,
    M,
    TODAY
  );
  const input = {
    origin: "https://acme.aims-hq.com",
    companyName: "Northside <Plumbing>",
    meetingId: M,
    meetingDateIso: TODAY,
    todayIso: TODAY,
    groups,
  };

  it("puts the reader's own commitments first, marked as theirs", () => {
    const html = renderWeeklyMeetingEmail(input, { id: "marcus", firstName: "Marcus", isCoach: false });
    expect(html.indexOf("Marcus Webb")).toBeLessThan(html.indexOf("Dana Lee"));
    expect(html).toContain("(you)");
    expect(html).toContain("Hi Marcus.");
  });

  it("gives the Coach no (you) group and a footer that says why", () => {
    const html = renderWeeklyMeetingEmail(input, { id: "coach", firstName: "Casey", isCoach: true });
    expect(html).not.toContain("(you)");
    expect(html).toContain("the AiMS Coach for Northside &lt;Plumbing&gt;");
  });

  it("links each commitment to its drawer and the button to the meeting", () => {
    const html = renderWeeklyMeetingEmail(input, { id: "dana", firstName: null, isCoach: false });
    expect(html).toContain(`https://acme.aims-hq.com/commitments?open=m1&amp;company=${CO}`);
    expect(html).toContain(`https://acme.aims-hq.com/issues?open=d1&amp;company=${CO}`);
    expect(html).toContain(`https://acme.aims-hq.com/leadership/meetings/${M}`);
    expect(html).toContain("Was due Monday 16 November");
    expect(html).toContain("up to <strong");
    expect(html).toContain("Tuesday 24 November");
  });

  it("says so when nothing is due", () => {
    const html = renderWeeklyMeetingEmail({ ...input, groups: [] }, { id: "dana", firstName: "Dana", isCoach: false });
    expect(html).toContain("Nothing is due across the team in the next week");
    expect(html).not.toContain("agreed in this meeting");
  });
});

describe("helpers", () => {
  it("writes a date as the weekday, day and month", () => {
    expect(longDate("2026-11-17")).toBe("Tuesday 17 November");
  });
  it("counts in the inbox preview", () => {
    expect(previewText([])).toBe("Nothing is due across the team in the next week.");
  });
});
