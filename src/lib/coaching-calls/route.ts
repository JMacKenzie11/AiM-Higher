import { turnsOf } from "@/lib/transcripts/turns";

// WHICH COMPANY A CALL FROM A COACH'S OWN FOLDER BELONGS TO (0326).
//
// A coach keeps one folder (Google Meet's "Meet Recordings", say)
// holding calls with every client. Each file is routed among the
// coach's ASSIGNED companies only, never anywhere else:
//
//   1. its file name holds one of a company's aliases (the same
//      lower-case substring rule as routeByFilename);
//   2. else, somebody on the call is a person at one of those
//      companies, by full name or email, the coach left out;
//   3. else, or when either step points at more than one company, it
//      waits in the coach's Calls to sort.
//
// Strict on purpose, as routeByFilename is: a call filed under the
// wrong company is read by that company's champion. "More than one"
// never guesses.
//
// Pure: no database, no server imports, so every case is a unit test.

export type CoachCompany = {
  id: string;
  aliases: readonly string[];
  people: ReadonlyArray<{ id: string; name: string; email: string | null }>;
};

export type CoachRouteDecision =
  | { kind: "routed"; companyId: string; by: "alias"; alias: string }
  | { kind: "routed"; companyId: string; by: "person"; personId: string; personName: string }
  | { kind: "unsorted"; reason: "no_match" | "several"; companyIds: string[] };

export function routeCoachCall(input: {
  fileName: string;
  transcript: string;
  companies: readonly CoachCompany[];
  coach: { id: string; name: string | null; email: string | null };
}): CoachRouteDecision {
  // 1. The file name.
  const name = input.fileName.toLowerCase();
  const byAlias = new Map<string, string>();
  for (const c of input.companies) {
    for (const a of c.aliases) {
      const needle = a.trim().toLowerCase();
      if (needle && name.includes(needle) && !byAlias.has(c.id)) byAlias.set(c.id, a.trim());
    }
  }
  if (byAlias.size === 1) {
    const [companyId, alias] = [...byAlias.entries()][0];
    return { kind: "routed", companyId, by: "alias", alias };
  }
  if (byAlias.size > 1) return { kind: "unsorted", reason: "several", companyIds: [...byAlias.keys()] };

  // 2. The people on the call.
  const on = participantsOf(input.transcript);
  const coachName = norm(input.coach.name ?? "");
  const coachEmail = (input.coach.email ?? "").toLowerCase();
  const hits = new Map<string, { personId: string; personName: string }>();
  for (const c of input.companies) {
    for (const p of c.people) {
      if (p.id === input.coach.id) continue;
      const pName = norm(p.name);
      const pEmail = (p.email ?? "").toLowerCase();
      if (pName && pName === coachName) continue;
      if (pEmail && pEmail === coachEmail) continue;
      const named = pName !== "" && on.names.has(pName);
      const mailed = pEmail !== "" && on.emails.has(pEmail);
      if ((named || mailed) && !hits.has(c.id)) hits.set(c.id, { personId: p.id, personName: p.name });
    }
  }
  if (hits.size === 1) {
    const [companyId, hit] = [...hits.entries()][0];
    return { kind: "routed", companyId, by: "person", ...hit };
  }
  if (hits.size > 1) return { kind: "unsorted", reason: "several", companyIds: [...hits.keys()] };
  return { kind: "unsorted", reason: "no_match", companyIds: [] };
}

// Who was on the call, as the transcript says: each turn's speaker
// ("Dana Ruiz: ..."), the names on an "Attendees" line or block (Google
// Meet starts its transcript with one), and every email address in the
// opening of the file. Names are compared whole and case-blind; a
// "Speaker 2" label matches nobody.
export function participantsOf(transcript: string): { names: Set<string>; emails: Set<string> } {
  const names = new Set<string>();
  const emails = new Set<string>();
  for (const t of turnsOf(transcript)) {
    if (t.speaker && !/^speaker\s*\d+$/i.test(t.speaker.trim())) names.add(norm(t.speaker));
  }
  const head = transcript.slice(0, 4000);
  const lines = head.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:attendees|participants)\s*:?\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    const list = m[1].trim() || (lines[i + 1] ?? "");
    for (const part of list.split(/[,;]/)) {
      const n = norm(part.replace(/<[^>]*>/g, ""));
      if (n) names.add(n);
    }
  }
  for (const e of head.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
    emails.add(e.toLowerCase());
  }
  return { names, emails };
}

// What the Calls to sort card says about an auto-filed call.
export function matchedBecause(m: { routed_by_alias: string | null; personName: string | null }): string | null {
  if (m.routed_by_alias) return `matched "${m.routed_by_alias}" in the name`;
  if (m.personName) return `matched ${m.personName} on the call`;
  return null;
}

// The word prefilled under "Remember for next time" (the coach can edit it): the
// first word of the file name that names something, so "Benson weekly
// 1:1 - Transcript" offers "Benson".
const NOT_A_NAME = new Set([
  "meeting", "call", "calls", "transcript", "weekly", "notes", "recording",
  "with", "and", "the", "for", "coaching", "check", "sync", "copy", "of",
]);
export function suggestAlias(fileName: string): string | null {
  for (const word of fileName.replace(/\.[a-z0-9]+$/i, "").split(/[^A-Za-z0-9&'-]+/)) {
    if (word.length >= 3 && !NOT_A_NAME.has(word.toLowerCase()) && !/^\d/.test(word)) return word;
  }
  return null;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
