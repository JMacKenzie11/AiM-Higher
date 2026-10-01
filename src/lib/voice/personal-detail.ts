// Nothing about a person's private life on a page about their work.
//
// ---- WHY ---------------------------------------------------------
//
// Generated copy about a meeting is read by people who were not in
// the room. A check-in's "how is everyone" kept turning into a record
// about somebody: the Centre North invitation card gave Jeff's
// doctor's appointment as why he was away (2026-09-29), a Benson
// question spoke of "Darlene's hospital countdown", and on 2026-10-01
// 13 of production's 40 meeting summaries named somebody's health,
// family or a bereavement. Summaries are read by the whole company
// and, since #379, by Aimee for anyone who asks.
//
// The rule is PERSONAL_DETAIL_RULE below, one wording for every
// surface. This module is the one place the words live. The
// invitation card (guide/headline.ts), the meeting questions
// (leadership/questions.ts) and the meeting analysis
// (transcripts/summary.ts, transcripts/redact.ts) all check through
// it, so the surfaces cannot drift apart.
//
// ---- TWO MODES ---------------------------------------------------
//
// "record": a record of the work (a summary, a commitment, the
//   invitation card). The ALWAYS words count anywhere. The PERSONAL
//   words count only when they are somebody's: straight after a named
//   person or he / she / his / her, in a personal construction ("Sam
//   was out with the flu", "her injury"). A clinic's "post-surgery
//   rehab programme" and "every cancelled appointment" are its work.
//
// "moment": a short line of coaching about one moment (a meeting
//   question and its From line). There is no business reason for a
//   health word in a question, so ALWAYS and PERSONAL count anywhere,
//   and so do the clinical words (MOMENT_ONLY).
//
// Deliberately in neither for a record: "diagnostic", "medical",
// "therapy", "doctor", "appointment" on their own. On 2026-10-01 they
// were business vocabulary in most production summaries that used
// them, and a physiotherapy clinic's meeting is made of them.
//
// ---- TIME OFF AND FAMILY (Jason, 2026-10-01) ---------------------
//
// Time off is allowed: "Sam is away next week, so Lee covers
// Thursday" stays, and so does "on vacation". Why and where never
// are: "for his anniversary", "on vacation in Mexico".
//
// Family members are part of many clients' businesses ("his father
// founded the company", "her brother runs the Denver branch"). A
// family word counts only as the reason for an absence ("away to look
// after his mother", "off because his son is sick"), or beside a
// person's private situation, which the other words already catch
// ("his father is in hospital").
//
// A place on its own cannot be told from a work trip by a pattern
// ("Sam is in Denver"), so only a place after a holiday word is
// caught. The prompts carry the rest.
//
// A regular expression is a floor, not a judge: it misses some
// phrasings and catches a few harmless ones. The prompts carry the
// rule; this makes the plainest slips impossible to store.

import { splitSentences } from "./sentences";

export type PersonalDetailMode = "record" | "moment";

// The rule as every prompt states it: the invitation card's wording
// (Jason, 2026-09-29), with time off, family and the private-situation
// clause settled for the summary (2026-10-01). Prompts carry it; the
// matcher below enforces it.
export const PERSONAL_DETAIL_RULE =
  "Never mention health, family, or personal reasons for anybody's absence, or where they were instead. You may say somebody is away and who covers for them; leave out why and where. Family members' roles in the business are fine to mention. Nothing about a person's private situation.";

const FAMILY =
  "wife|husband|partner|spouse|fianc[eé]e?|son|daughter|kids?|child|children|mother|father|mom|mum|dad|parents?|baby|grand(?:child|children|son|daughter|baby|babies|mother|father|parents?)|sister|brother|in-laws?";

// Private whatever the sentence.
const ALWAYS = [
  "funerals?",
  "bereave\\w*",
  "passed away",
  "grie(?:f|ving)",
  "maternity",
  "paternity",
  "pregnan\\w*",
  "miscarriage",
  "honeymoon",
  "sick (?:day|days|leave|note)",
  "off sick",
  "out sick",
  "called in sick",
  "family (?:emergenc(?:y|ies)|reasons?|matters?|commitments?|situation|issues?)",
  "personal (?:reasons?|matters?|situation|issues?|day)",
  "health (?:issues?|reasons?|problems?|scare|condition|concerns?)",
  "mental health",
  "medical (?:leave|appointment|procedure|condition)",
  "compassionate leave",
  "leave of absence",
  "divorc\\w*",
  "chemo\\w*",
  "hospitali[sz]ed",
  "in (?:the )?hospital",
  "doctor['’]?s appointment",
  "dentist",
  // A family member as the reason, without an absence word.
  `to (?:look after|care for|be with|visit|see|help|pick up|collect) (?:his|her|their|my) (?:${FAMILY})`,
];

// Private when they are somebody's; ordinary work vocabulary otherwise.
const PERSONAL = [
  "hospital\\w*",
  "surger(?:y|ies)",
  "surgical",
  "illness",
  "ill",
  "sick",
  "unwell",
  "injur\\w*",
  "cancer",
  "covid",
  "flu",
  "migraine",
  "concussion",
  "wedding",
  "anniversary",
  "birthday",
  "newborn",
  "bab(?:y|ies)",
  "birth",
  "grandchild\\w*",
  "grandbab\\w*",
];

// Clinical words that a short coaching line has no business using,
// though a record of a clinic's work is full of them.
const MOMENT_ONLY = [
  "diagnos\\w*",
  "medical",
  "medication",
  "doctor\\w*",
  "therap\\w*",
  "death",
  "died",
];

const ABSENCE =
  "away|off|out|absent|on (?:vacation|holiday|leave|pto)|time off|days? off|leave|missed (?:the|this|today['’]s) meeting|couldn['’]t (?:make it|attend|join)";
const REASON = "for|because(?: of)?|due to|to|with|visiting|attending|at";

const anyOf = (words: readonly string[]) => `(?:${words.join("|")})`;

// Where, after a holiday word: "on vacation in Mexico". Case-sensitive
// on the place. Not "trip": a trip to Toronto is as often a client
// visit as a holiday (the 2026-10-01 proposals caught one).
const HOLIDAY_PLACE =
  /\b(?:[Vv]acation|[Hh]oliday|[Cc]ruise|[Gg]etaway)\s+(?:in|to|at)\s+(?:the\s+)?[A-Z][a-z]+/;

// After a name, he, she or I: a possessive or a verb of state. After
// his / her / him / my: nothing more. Then up to four words, then the
// term. "I" and "my" because a missed commitment quotes the speaker
// ("I'm taking Mum to hospital Friday").
const STATE =
  "(?:['’]s|['’]m|\\s+(?:am|is|was|were|has|had|have|will be|has been|had been|is having|was having|had to|needs?|needed|went|got|came down|recovering|off|out|away|home))";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Full names and first names, longest first, so "Sam Lee" is tried
// before "Sam".
function nameAlternatives(people: readonly string[]): string[] {
  const names = new Set<string>();
  for (const p of people) {
    const full = p.trim();
    if (full.length >= 2) names.add(full);
    const first = full.split(/\s+/)[0] ?? "";
    if (first.length >= 2) names.add(first);
  }
  return [...names].sort((a, b) => b.length - a.length).map(escapeRegExp);
}

type Patterns = { always: RegExp; somebodys: RegExp; familyReason: RegExp };

function patternsFor(people: readonly string[]): Patterns {
  const names = nameAlternatives(people);
  const subjects = [...names, "he", "she", "i"].join("|");
  const owners = ["his", "her", "their", "my", ...names.map((n) => `${n}['’]s`)].join("|");
  return {
    always: new RegExp(`\\b${anyOf(ALWAYS)}\\b`, "i"),
    somebodys: new RegExp(
      `(?:\\b(?:${subjects})${STATE}|\\b(?:his|her|him|my)\\b)(?:\\W+\\w+){0,4}?\\W+${anyOf(PERSONAL)}\\b`,
      "i"
    ),
    // A family member given as the reason for an absence.
    familyReason: new RegExp(
      `\\b(?:${ABSENCE})\\b(?:\\W+\\w+){0,4}?\\W+(?:${REASON})\\b(?:\\W+\\w+){0,3}?\\W+(?:${owners})\\s+(?:${FAMILY})\\b`,
      "i"
    ),
  };
}

const MOMENT_RE = new RegExp(`\\b${anyOf([...ALWAYS, ...PERSONAL, ...MOMENT_ONLY])}\\b`, "i");

export type PersonalDetailOptions = {
  mode: PersonalDetailMode;
  // Names the text can refer to: the roster and the speakers. Used in
  // "record" mode; without them only ALWAYS and the pronouns count.
  people?: readonly string[];
};

// A matcher built once per call site: the name patterns are compiled
// from the roster, so a long summary is not recompiling them per line.
export type PersonalDetailMatcher = (text: string) => string | null;

export function personalDetailMatcher(opts: PersonalDetailOptions): PersonalDetailMatcher {
  const p = patternsFor(opts.people ?? []);
  const shared = (text: string) =>
    p.familyReason.exec(text)?.[0] ?? HOLIDAY_PLACE.exec(text)?.[0] ?? null;
  if (opts.mode === "moment") {
    return (text) => MOMENT_RE.exec(text)?.[0] ?? shared(text);
  }
  return (text) => p.always.exec(text)?.[0] ?? p.somebodys.exec(text)?.[0] ?? shared(text);
}

export type PersonalDetail = {
  sentence: string;
  // What matched. Never logged or stored.
  matched: string;
};

// Text is read line by line, so markdown survives: a heading or a
// blank line is never touched, and a line's bullet or quote marker is
// kept apart from its sentences. Finding, rewriting and removing all
// read it this way, so they agree on what a sentence is.
type Line = { verbatim: string } | { original: string; prefix: string; sentences: string[] };

function linesOf(text: string, match: PersonalDetailMatcher): Line[] {
  return text.split("\n").map((line) => {
    if (/^\s*#/.test(line) || line.trim().length === 0 || !match(line)) return { verbatim: line };
    const prefix = /^\s*(?:[-*+]|\d+[.)]|>)\s+/.exec(line)?.[0] ?? "";
    return { original: line, prefix, sentences: splitSentences(line.slice(prefix.length)) };
  });
}

const matcherOf = (opts: PersonalDetailOptions | PersonalDetailMatcher): PersonalDetailMatcher =>
  typeof opts === "function" ? opts : personalDetailMatcher(opts);

// Every sentence in `text` that mentions somebody's private life.
export function findPersonalDetail(
  text: string,
  opts: PersonalDetailOptions | PersonalDetailMatcher
): PersonalDetail[] {
  const match = matcherOf(opts);
  const found: PersonalDetail[] = [];
  for (const line of linesOf(text, match)) {
    if ("verbatim" in line) continue;
    for (const sentence of line.sentences) {
      const matched = match(sentence);
      if (matched) found.push({ sentence, matched });
    }
  }
  return found;
}

// Replaces each sentence that mentions somebody's private life with
// its rewrite, when there is one and it passes the same check, and
// takes the sentence out otherwise. Everything else is kept exactly as
// written: a line with nothing to change is never rebuilt, and a bullet
// or quote left with nothing in it goes. Counts are for the log.
export function rewritePersonalDetail(
  text: string,
  opts: PersonalDetailOptions | PersonalDetailMatcher,
  rewriteOf: (sentence: string) => string | null | undefined
): { text: string; reworded: number; removed: number } {
  const match = matcherOf(opts);
  let reworded = 0;
  let removed = 0;
  const out: string[] = [];
  for (const line of linesOf(text, match)) {
    if ("verbatim" in line) {
      out.push(line.verbatim);
      continue;
    }
    if (!line.sentences.some((s) => match(s))) {
      out.push(line.original);
      continue;
    }
    const kept: string[] = [];
    for (const s of line.sentences) {
      if (!match(s)) {
        kept.push(s);
        continue;
      }
      const rewrite = rewriteOf(s)?.trim();
      if (rewrite && !match(rewrite)) {
        kept.push(rewrite);
        reworded++;
      } else {
        removed++;
      }
    }
    if (kept.length > 0) out.push(line.prefix + kept.join(" "));
  }
  return { text: out.join("\n"), reworded, removed };
}

// Takes out each sentence that mentions somebody's private life.
export function removePersonalDetail(
  text: string,
  opts: PersonalDetailOptions | PersonalDetailMatcher
): { text: string; removed: number } {
  const { text: out, removed } = rewritePersonalDetail(text, opts, () => null);
  return { text: out, removed };
}
