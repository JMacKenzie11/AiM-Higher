import {
  findBannedPhrases,
  describeHits,
  retryInstruction,
  type BannedHit,
} from "@/lib/voice/banned";
import {
  findUnsupportedQuotes,
  quoteRetryInstruction,
  type UnsupportedQuote,
} from "@/lib/voice/quotes";

// WHAT A DEBRIEF REPLY GOT WRONG, checked before the champion reads it.
//
// The debrief's first turn is the invitation's own line, checked when
// it was raised (guide/headline.ts). Every reply after it is written
// by the model, and on dev every one of them broke a rule that can be
// counted (2026-09-28): "the room", "X instead of Y", "Nobody had a
// bad intent here", and quotes nobody said ("who screwed up the
// schedule this time", "how much do they want"). A quote hands the
// leader a false record of their own meeting.
//
// So a debrief reply is held back rather than streamed (/api/coach),
// checked here, and sent back once with what was wrong, the way the
// headline and a generated opener are. The same shape as
// opener-checks.ts, so the route runs one flow for both.
//
// Quotes are checked against what was said: the meeting transcript,
// read by the route under the champion's own session and never shown
// to the model. An empty transcript skips the quote check rather than
// passing everything as invented.

// Reassurance by denying the opposite. Narrow on purpose: a pattern
// that fires on ordinary sentences would send good replies back.
const DENIALS: ReadonlyArray<RegExp> = [
  /\b(?:nobody|no one|no-one)\s+(?:had|meant|was)\s+(?:a\s+)?(?:bad|ill|wrong)\b[^.?!]*/gi,
  /\b(?:that|this|it)(?:'s|’s|\s+is|\s+was)\s+not\s+(?:a\s+)?(?:small|little|minor|nothing)\b[^.?!]*/gi,
  /\bthis\s+(?:isn't|isn’t|is\s+not)\s+about\s+blame\b[^.?!]*/gi,
];

// Talking about an attempt the person never saw.
//
// A reply that breaks a rule is sent back once with what was wrong
// (the route's retry), and that note reaches the model as the next
// thing in the conversation. On dev it answered the note: "Fair. Let
// me redo that part." went out to the champion as if they had
// corrected her (2026-09-29). Only a sentence that IS the
// acknowledgement counts: "Fair question" and "Right after the
// debate" are ordinary openings.
const ACKNOWLEDGED =
  /^(?:fair(?: enough)?|you(?:'|’)?re right|good (?:catch|point)|got it|understood|noted|my (?:mistake|bad)|apologies|sorry|ok(?:ay)?)(?:[.!,:]|\s*$)/i;
const REDOING =
  /\b(?:let me|i(?:'|’)ll|i will|here(?:'|’)s|here is)\b[^.?!]*\b(?:redo|rewrite|rewriting|rephrase|try (?:that|this|it) again)\b/i;
const EARLIER_VERSION = /\b(?:my (?:previous|last|earlier|first)|previous|earlier) (?:version|attempt|draft)\b/i;

function sentences(text: string): Array<{ text: string; end: number }> {
  return [...text.matchAll(/[^.?!\n]+[.?!]*/g)]
    .map((m) => ({ text: m[0].trim(), end: (m.index ?? 0) + m[0].length }))
    .filter((x) => x.text.length > 0);
}

function isMeta(sentence: string): boolean {
  return ACKNOWLEDGED.test(sentence) || REDOING.test(sentence) || EARLIER_VERSION.test(sentence);
}

// The retry's own preamble, taken off before it is checked or shown.
// Only from the front: the reply itself starts where it stops.
export function stripRetryPreamble(text: string): string {
  let cut = 0;
  for (const s of sentences(text)) {
    if (!isMeta(s.text)) break;
    cut = s.end;
  }
  return text.slice(cut).trim();
}

// Sent back with whatever was wrong. The note arrives as the next turn
// of the conversation, so without this the model answers it instead
// of replacing what it wrote.
export function rewriteRequest(instruction: string): string {
  return (
    `${instruction} Write the whole message again, exactly as they will ` +
    `read it. It replaces what you wrote, and they never saw that, so ` +
    `write it as if for the first time: no acknowledgement, no preamble, ` +
    `and never mention a previous version.`
  );
}

export type ReplyFaults = {
  banned: BannedHit[];
  denials: string[];
  invented: UnsupportedQuote[];
  meta: string[];
};

export function checkDebriefReply(text: string, transcript: string): ReplyFaults {
  const denials: string[] = [];
  for (const re of DENIALS) {
    for (const m of text.matchAll(re)) denials.push(m[0].trim());
  }
  return {
    banned: findBannedPhrases(text),
    denials,
    invented: transcript.length > 0 ? findUnsupportedQuotes(text, transcript) : [],
    meta: sentences(text).map((x) => x.text).filter(isMeta),
  };
}

export function replyFaultCount(f: ReplyFaults): number {
  return f.banned.length + f.denials.length + f.invented.length + f.meta.length;
}

// For the log: what is wrong, where, in one line.
export function describeReplyFaults(f: ReplyFaults): string {
  return [
    f.invented.length > 0
      ? `invented quote(s) ${f.invented.map((q) => `"${q.quote}"`).join(", ")}`
      : null,
    f.denials.length > 0
      ? `affirming by denial ${f.denials.map((d) => `"${d}"`).join(", ")}`
      : null,
    f.meta.length > 0
      ? `talked about a previous attempt ${f.meta.map((m) => `"${m}"`).join(", ")}`
      : null,
    f.banned.length > 0 ? describeHits(f.banned) : null,
  ]
    .filter(Boolean)
    .join("; ");
}

// Most serious first: a quote nobody said, then the rest.
export function replyRetryInstruction(f: ReplyFaults): string {
  return [
    f.invented.length > 0 ? quoteRetryInstruction(f.invented) : null,
    f.denials.length > 0
      ? `You reassured by denying the opposite (${f.denials
          .map((d) => `"${d}"`)
          .join(", ")}). Say what is true, in plain words.`
      : null,
    f.meta.length > 0
      ? `You wrote about an earlier attempt (${f.meta
          .map((m) => `"${m}"`)
          .join(", ")}). They never saw one. Leave that out.`
      : null,
    f.banned.length > 0 ? retryInstruction(f.banned) : null,
  ]
    .filter(Boolean)
    .join(" ");
}
