// WHO CAN OWN A COMMITMENT MADE IN THIS MEETING.
//
// Somebody who was in it. A Benson summary gave "get the weekly
// numbers into the success measures" to Jon Billings, who was noted
// as absent in the same summary: Casey had said "I'll see if he can
// get them added in here... I got to go work with John still." That
// is Casey's commitment to go and work with John. Production's run of
// the same meeting gave it to somebody else who was not there.
//
// The prompt now says so, and this makes it hold. An owner who is not
// among the people identified as present is cleared, and the
// commitment comes out Unassigned with its description intact.
//
// ---- WHERE "PRESENT" COMES FROM --------------------------------
//
// Two sources, and a person in either counts:
//
//   1. The speaker map, high or medium confidence. The same bar
//      formatSpeakerMap uses to hand a name to the later calls.
//   2. The summary's own "## Attendees" list, bullet lines only.
//      That list is written from the transcript and the map; it is
//      how a person who spoke under an unmapped label, or was named
//      as there without speaking much, still counts. Lines that
//      hedge (likely, unconfirmed, unidentified) or record an absence
//      are skipped.
//
// ---- THE TRADE ------------------------------------------------
//
// A person who really was there but appears in neither source loses
// the commitment to Unassigned. That is visible on the page and one
// click to fix. The failure it replaces, work silently put on the
// list of somebody who was not in the room, is neither.
//
// When neither source names anybody (the speaker map failed and the
// summary has no attendee list) the check does not run: an empty set
// would clear every owner, which is a different kind of wrong.

type RosterPerson = { id: string; full_name: string };

const HEDGED = /\b(likely|possibly|probably|unconfirmed|unidentified|absent|not in attendance|not present|apolog)/i;

export function attendeesFromSummary(markdown: string): string[] {
  const section = /^##\s+Attendees\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(markdown)?.[1] ?? "";
  return section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .filter((l) => l.length > 0 && !HEDGED.test(l));
}

export function presentOwnerIds(
  roster: readonly RosterPerson[],
  identifiedSpeakers: readonly string[],
  summaryAttendees: readonly string[]
): Set<string> | null {
  const lines = [...identifiedSpeakers, ...summaryAttendees].map((s) => s.toLowerCase());
  if (lines.length === 0) return null;
  const ids = new Set<string>();
  for (const p of roster) {
    const name = p.full_name.trim().toLowerCase();
    if (name.length === 0) continue;
    // Whole-name match inside the line, so "- Casey Benson (CEO)"
    // counts and "Casey" alone does not claim a Casey Smith as well.
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (lines.some((l) => re.test(l))) ids.add(p.id);
  }
  return ids;
}
