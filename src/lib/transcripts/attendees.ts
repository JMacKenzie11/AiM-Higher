// WHO CAN OWN A COMMITMENT MADE IN THIS MEETING.
//
// Somebody who was in it. A Benson summary gave "get the weekly
// numbers into the success measures" to Jon Billings, who was noted
// as absent in the same summary: Casey had said "I'll see if he can
// get them added in here... I got to go work with John still." That
// is Casey's commitment to go and work with John.
//
// An owner who is not among the people identified as present is
// cleared, and the commitment comes out Unassigned with its
// description intact.
//
// ---- WHERE "PRESENT" COMES FROM --------------------------------
//
// Three sources, and a person in any of them counts:
//
//   1. The speaker map, high or medium confidence.
//   2. The summary's own "## Attendees" section, as NAMES. It may be
//      a bullet list or a sentence: a Geo-Sci summary wrote "Jeff
//      Bouwman, Woody Aboumrad, George Aboumrad, Andy Hunt, Kyle
//      Carey." as prose, the first version read bullets only, found
//      nobody, and cleared every one of Jeff's commitments on three
//      runs out of three. Lines or sentences that hedge (likely,
//      unconfirmed, unidentified) or record an absence are skipped.
//   3. The AiMS guides assigned to the company, always. They run the
//      meeting and leave it with commitments; whether the summary
//      happened to list them is not evidence they were absent (Jason,
//      2026-09-25). Every assigned profile counts, since one person
//      can hold a guide profile and a system admin profile.
//
// The page's attendee strip reads the same names, so the strip and
// the owner check can never disagree about who was there.
//
// ---- THE TRADE ------------------------------------------------
//
// A person who really was there but appears in none of the three
// loses the commitment to Unassigned. That is visible on the page and
// one click to fix. The failure it replaces, work silently put on the
// list of somebody who was not in the room, is neither.
//
// When no source names anybody (no speaker map, no attendee section,
// no assigned guide) the check does not run: an empty set would clear
// every owner, which is a different kind of wrong.

type RosterPerson = { id: string; full_name: string };

const HEDGED =
  /\b(likely|possibly|probably|unconfirmed|unidentified|absent|not in attendance|not present|did not attend|didn't attend|apolog\w*|on leave|on vacation|referenced)\b/i;

// One to five words, each starting with a capital or a digit: "Casey
// Benson", "E2E Company Admin", "Jean-Luc O'Neil".
const NAME = /^[A-Z0-9][\w'’.-]*(?:\s+[A-Z0-9][\w'’.-]*){0,4}$/;

function clean(part: string): string {
  return part
    .replace(/\*\*/g, "")
    .replace(/\s*\([^)]*\)/g, "") // "Casey Benson (CEO)"
    .split(/\s[—–-]\s|:/)[0] // "Casey Benson — CEO", "Casey Benson: CEO"
    .replace(/[.;]+$/, "")
    .trim();
}

export function attendeesFromSummary(markdown: string): string[] {
  const section = /^##\s+Attendees\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(markdown)?.[1] ?? "";
  const names: string[] = [];
  const add = (n: string) => {
    if (n && NAME.test(n) && !names.includes(n)) names.push(n);
  };
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*]\s+/.test(line)) {
      // A bullet is one person, possibly with a role after it.
      const item = line.replace(/^[-*]\s+/, "");
      // Parentheses first: a comma inside "(Plant Manager, Acting)" is
      // not the end of the name.
      if (!HEDGED.test(item)) add(clean(clean(item).split(",")[0]));
      continue;
    }
    // Prose: sentence by sentence, dropping any that hedge or record
    // an absence, then a comma or "and" separated list of names.
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      if (HEDGED.test(sentence)) continue;
      for (const part of sentence.replace(/\s*\([^)]*\)/g, "").split(/,\s*|\s+and\s+/)) add(clean(part));
    }
  }
  return names;
}

export function presentOwnerIds(
  roster: readonly RosterPerson[],
  identifiedSpeakers: readonly string[],
  summaryAttendees: readonly string[],
  assignedGuideIds: readonly string[] = []
): Set<string> | null {
  const names = new Set([...identifiedSpeakers, ...summaryAttendees].map((s) => s.trim().toLowerCase()));
  if (names.size === 0 && assignedGuideIds.length === 0) return null;
  const ids = new Set<string>(assignedGuideIds);
  const lines = [...names];
  for (const p of roster) {
    const name = p.full_name.trim().toLowerCase();
    if (name.length === 0) continue;
    // The whole name inside an entry, so "Casey Benson Jr" counts for
    // Casey Benson and "Casey" alone never claims a Casey Smith.
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (lines.some((l) => re.test(l))) ids.add(p.id);
  }
  return ids;
}
