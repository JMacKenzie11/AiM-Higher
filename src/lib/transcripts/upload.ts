// Upload a transcript: the pure parts, shared by the action and its
// tests. The action is ./upload-action.ts.

// A meeting row needs a provider_file_id (NOT NULL) and an uploaded
// transcript has no provider. The content hash stands in, so the same
// text uploaded twice collides on the per-company hash check before it
// gets this far.
export function uploadFileId(hash: string): string {
  return `upload:${hash}`;
}

// The roles Meeting Summaries offers Upload to: everyone who manages
// the company's meetings (system_admin, its company_admin, an assigned
// aims_guide: canManageCompanyMeetings), plus the company's AiMS
// champion, whatever their role. The champion is the person who runs
// the rhythm, often a team_member.
export function canUploadTranscript(opts: {
  managesMeetings: boolean;
  isChampion: boolean;
}): boolean {
  return opts.managesMeetings || opts.isChampion;
}

// The title shown in Meeting Summaries. What the person typed, else the
// transcript's first line when it reads like a heading (Teams and Otter
// exports start with the meeting's name), else the file name, else a
// dated fallback.
export function uploadTitle(opts: {
  typed: string;
  firstLine: string | null;
  fileTitle: string | null;
  meetingDate: string;
}): string {
  const typed = opts.typed.trim();
  if (typed) return typed.slice(0, 200);
  const first = (opts.firstLine ?? "").trim();
  if (first && first.length <= 120 && !/^\d{1,2}:\d{2}/.test(first)) return first;
  if (opts.fileTitle?.trim()) return opts.fileTitle.trim().slice(0, 200);
  return `Meeting on ${opts.meetingDate}`;
}

// When the meeting happened, as the timestamp the meeting row is
// created with. The analysis reads "by Friday" against this date, and
// Meeting Summaries lists by it, so a meeting uploaded a day late still
// sits on the day it was held.
//
// Today (in the company's timezone) is "now". Any earlier day is noon
// that day in the company's timezone. A date in the future, or one that
// isn't a date, is refused with null.
export function meetingInstant(
  ymd: string,
  timeZone: string,
  now: Date = new Date()
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const today = ymdIn(now, timeZone);
  if (ymd > today) return null;
  if (ymd === today) return now.toISOString();
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 12, 0, 0);
  const offset = offsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60_000).toISOString();
}

export function ymdIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

// Minutes the zone is ahead of UTC at that instant (New York in
// November: -300).
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}
