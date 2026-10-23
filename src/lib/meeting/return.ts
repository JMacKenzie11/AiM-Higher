// The way back to the weekly meeting from a page opened in it. The
// meeting's Strategy step links to a priority, goal or focus area with
// ?from=<the step's address>, and that page offers "Back to the
// meeting". Only an address on the meeting page is taken, so the link
// cannot be pointed anywhere else.

export const BACK_TO_MEETING = "Back to the meeting";

export function meetingReturn(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || s.length > 500) return null;
  if (!s.startsWith("/meeting?") || /[\\\s]|\/\//.test(s)) return null;
  return s;
}

// The query a link from the meeting adds: empty when not in one.
export function fromMeeting(from: string | null | undefined): string {
  return from ? `?from=${encodeURIComponent(from)}` : "";
}
