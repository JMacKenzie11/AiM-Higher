import "server-only";

// RESOLVING WHAT SOMEBODY SAID ABOUT WHEN, IN CODE.
//
// ---- WHY NOT LET THE MODEL DO IT -------------------------------
//
// It was doing it, and it was wrong in two ways at once on a real
// meeting. Casey said "I'm going to do it tonight" and the date came
// back as that Friday. The same commitment resolved to Friday the
// 25th on one run and Saturday the 26th on the next, from an
// identical transcript.
//
// Both are the same failure: date arithmetic is not a judgement, and
// a model asked to do it will sometimes reach for a safer-feeling
// answer and sometimes just miscount. Neither is something a prompt
// fixes, because there is nothing to explain — the answer is
// mechanical.
//
// So the model reports the PHRASE IT HEARD, verbatim, and this
// resolves it against the meeting's own date. Same input, same
// output, every time.
//
// ---- THE MEETING'S OWN DATE ------------------------------------
//
// Resolution is against the meeting date in the COMPANY'S timezone,
// not the server's. A meeting recorded at 16:15 UTC is 13:15 in
// America/Halifax — same day here, but an evening meeting in a
// western timezone is the previous day in UTC, and "tonight" would
// land a day early for the whole team.

export type DuePhrase = string | null;

const FRIDAY = 5;

function isoInZone(date: Date, timeZone: string): string {
  // en-CA gives YYYY-MM-DD, which is the format we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  // 0 = Sunday .. 6 = Saturday
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

// The meeting's date, in the company's timezone.
export function meetingDateIn(
  meetingCreatedAt: string,
  timeZone: string
): string {
  return isoInZone(new Date(meetingCreatedAt), timeZone || "UTC");
}

// Resolve a phrase against that date. Returns null when the phrase
// says nothing definite — which is a real answer, and the caller
// then applies whatever default it has.
export function resolveDuePhrase(
  phrase: DuePhrase,
  meetingDateIso: string
): string | null {
  if (!phrase) return null;
  const p = phrase.toLowerCase().trim();

  // Same day. The one the model kept moving to Friday.
  if (
    /\b(today|tonight|this morning|this afternoon|this evening|by end of (the )?day|before i (leave|go home)|right after this|straight after)\b/.test(p)
  ) {
    return meetingDateIso;
  }

  if (/\btomorrow\b/.test(p)) return addDays(meetingDateIso, 1);

  // This week resolves to that week's Friday. When the meeting IS a
  // Friday, "this week" is that day rather than a week away.
  if (/\bthis week\b|\bend of (the )?week\b|\bby friday\b/.test(p)) {
    const wd = weekdayOf(meetingDateIso);
    const delta = (FRIDAY - wd + 7) % 7;
    return addDays(meetingDateIso, delta);
  }

  if (/\bnext week\b/.test(p)) {
    const wd = weekdayOf(meetingDateIso);
    return addDays(meetingDateIso, ((FRIDAY - wd + 7) % 7) + 7);
  }

  if (/\b(end of (the )?month|month end|by month.?end)\b/.test(p)) {
    const [y, m] = meetingDateIso.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  }

  // A named weekday: the next one on or after the meeting date.
  for (const [name, target] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(p)) {
      const wd = weekdayOf(meetingDateIso);
      const delta = (target - wd + 7) % 7;
      return addDays(meetingDateIso, delta);
    }
  }

  // An explicit ISO date the model copied out of the transcript.
  const iso = p.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  // "soon", "in the next few weeks", "when I get a chance" — these
  // say nothing a deadline can be built from, and pretending
  // otherwise is how a team ends up with dates nobody agreed.
  return null;
}
