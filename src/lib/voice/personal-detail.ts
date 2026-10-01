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
// The rule, one wording for every surface: never mention health,
// family, or personal reasons for anybody's absence, or where they
// were instead, and nothing about a person's private situation.
//
// This module is the one place the words live. The invitation card
// (guide/headline.ts), the meeting questions (leadership/questions.ts)
// and the meeting summary (transcripts/analyze.ts) all check through
// it, so the surfaces cannot drift apart.
//
// ---- TWO MODES ---------------------------------------------------
//
// "record": a record of the work (a summary, the invitation card).
//   The ALWAYS words count anywhere. The PERSONAL words count only
//   when they are somebody's: straight after a named person or he /
//   she / his / her, in a personal construction ("Sam was out with
//   the flu", "her injury"). A clinic's "post-surgery rehab
//   programme" and "every cancelled appointment" are its business.
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
// A regular expression is a floor, not a judge: it misses some
// phrasings and catches a few harmless ones. The prompts carry the
// rule; this makes the plainest slips impossible to store.

import { splitSentences } from "./sentences";

export type PersonalDetailMode = "record" | "moment";

// The rule as every prompt states it: the invitation card's wording
// (Jason, 2026-09-29), with the private-situation clause added for the
// summary (2026-10-01). Prompts carry it; the matcher below enforces it.
export const PERSONAL_DETAIL_RULE =
  "Never mention health, family, or personal reasons for anybody's absence, or where they were instead. If somebody was away, leave the reason out entirely. Nothing about a person's private situation.";

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
  "on (?:holiday|vacation|honeymoon)",
  `(?:his|her) (?:${FAMILY})`,
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
  "newborn",
  "bab(?:y|ies)",
  "birth",
  "grandchild\\w*",
  "grandbab\\w*",
  `(?:their|the) (?:${FAMILY})`,
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

const anyOf = (words: readonly string[]) => `(?:${words.join("|")})`;

const ALWAYS_RE = new RegExp(`\\b${anyOf(ALWAYS)}\\b`, "i");
const MOMENT_RE = new RegExp(`\\b${anyOf([...ALWAYS, ...PERSONAL, ...MOMENT_ONLY])}\\b`, "i");

// After a name or he / she: a possessive or a verb of state. After
// his / her / him: nothing more. Then up to four words, then the term.
const STATE =
  "(?:['’]s|\\s+(?:is|was|were|has|had|will be|has been|had been|is having|was having|had to|needs?|needed|went|got|came down|recovering|off|out|away|home))";

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

function somebodysPattern(people: readonly string[]): RegExp {
  const subjects = [...nameAlternatives(people), "he", "she"].join("|");
  return new RegExp(
    `(?:\\b(?:${subjects})${STATE}|\\b(?:his|her|him)\\b)(?:\\W+\\w+){0,4}?\\W+${anyOf(PERSONAL)}\\b`,
    "i"
  );
}

export type PersonalDetailOptions = {
  mode: PersonalDetailMode;
  // Names the text can refer to: the roster and the speakers. Used in
  // "record" mode; without them only ALWAYS and the pronouns count.
  people?: readonly string[];
};

// A matcher built once per call site: the name pattern is compiled
// from the roster, so a long summary is not recompiling it per line.
export type PersonalDetailMatcher = (text: string) => string | null;

export function personalDetailMatcher(opts: PersonalDetailOptions): PersonalDetailMatcher {
  if (opts.mode === "moment") {
    return (text) => MOMENT_RE.exec(text)?.[0] ?? null;
  }
  const somebodys = somebodysPattern(opts.people ?? []);
  return (text) => ALWAYS_RE.exec(text)?.[0] ?? somebodys.exec(text)?.[0] ?? null;
}

export type PersonalDetail = {
  sentence: string;
  // What matched, for the retry instruction. Never logged or stored.
  matched: string;
};

// Every sentence in `text` that mentions somebody's private life.
export function findPersonalDetail(
  text: string,
  opts: PersonalDetailOptions | PersonalDetailMatcher
): PersonalDetail[] {
  const match = typeof opts === "function" ? opts : personalDetailMatcher(opts);
  const found: PersonalDetail[] = [];
  for (const sentence of splitSentences(text)) {
    const matched = match(sentence);
    if (matched) found.push({ sentence, matched });
  }
  return found;
}

// Names the sentences, like the other retries: the rule was in the
// prompt and was already ignored.
export function personalDetailRetryInstruction(found: readonly PersonalDetail[]): string {
  return [
    "These sentences mention somebody's health, family or private life, which copy about their work must never do:",
    ...found.map((f) => `- "${f.sentence}"`),
    "Rewrite it with the personal detail left out entirely. If somebody was away, say nothing about why or where. Keep everything else as it was.",
  ].join("\n");
}

// Takes out each sentence that mentions somebody's private life, line
// by line, so markdown survives: a heading is never touched, and a
// bullet or quote left with nothing in it goes. Returns how many
// sentences went, for the log.
export function removePersonalDetail(
  text: string,
  opts: PersonalDetailOptions | PersonalDetailMatcher
): { text: string; removed: number } {
  const match = typeof opts === "function" ? opts : personalDetailMatcher(opts);
  let removed = 0;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line) || line.trim().length === 0 || !match(line)) {
      out.push(line);
      continue;
    }
    const prefix = /^\s*(?:[-*+]|\d+[.)]|>)\s+/.exec(line)?.[0] ?? "";
    const sentences = splitSentences(line.slice(prefix.length));
    const kept = sentences.filter((s) => !match(s));
    removed += sentences.length - kept.length;
    if (kept.length > 0) out.push(prefix + kept.join(" "));
  }
  return { text: out.join("\n"), removed };
}
