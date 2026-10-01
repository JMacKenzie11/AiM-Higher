// THE CARD'S FIRST LINE: WHICH MEETING, AND WHEN.
//
// Jason, 2026-09-29: the meeting's own name and its date, as in
// "Weekly Leadership Meeting, Thursday Sep 10", linking to its summary.
//
// Recorded titles carry the recording's housekeeping: "2026 09 10
// Weekly Leadership Meeting (Geo Sci)". The date and anything in
// brackets come out, and the rest is the meeting's name. When nothing
// is left, it is "Leadership meeting".

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";

const DATES: ReadonlyArray<RegExp> = [
  // 2026 09 10, 2026-09-10, 2026.09.10, 2026/9/10
  /\b\d{4}[ ._/-]+\d{1,2}[ ._/-]+\d{1,2}\b/g,
  // 09/10/2026, 10-09-26
  /\b\d{1,2}[ ._/-]+\d{1,2}[ ._/-]+\d{2,4}\b/g,
  // Sep 10, Sep 10 2026, September 10th, 2026
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),
  // 10 Sep 2026
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?\\b`, "gi"),
  // A leading "07 24": month and day with no year
  /^\s*\d{1,2}[ ._/-]+\d{1,2}\b/g,
];

export const MEETING_NAME_FALLBACK = "Leadership meeting";

export function cleanMeetingTitle(title: string | null | undefined): string {
  let t = title ?? "";
  // Anything in brackets, of any kind.
  t = t.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ");
  for (const re of DATES) t = t.replace(re, " ");
  return t
    .replace(/\s+/g, " ")
    // Separators left dangling where a date was: "- Weekly", "Weekly -".
    .replace(/^[\s\-–—:|,.]+|[\s\-–—:|,.]+$/g, "")
    .trim();
}

// "2026-09-10" → "Thursday Sep 10". The date is the company's calendar
// day already (nudges.ts is handed it that way), so it is read as a
// plain date, never shifted through a time zone.
export function meetingDayLabel(dateIso: string): string {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = day.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const month = day.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${weekday} ${month} ${d}`;
}

export function meetingLabel(title: string | null | undefined, dateIso: string): string {
  return `${cleanMeetingTitle(title) || MEETING_NAME_FALLBACK}, ${meetingDayLabel(dateIso)}`;
}
