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

export type ReplyFaults = {
  banned: BannedHit[];
  denials: string[];
  invented: UnsupportedQuote[];
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
  };
}

export function replyFaultCount(f: ReplyFaults): number {
  return f.banned.length + f.denials.length + f.invented.length;
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
    f.banned.length > 0 ? retryInstruction(f.banned) : null,
  ]
    .filter(Boolean)
    .join(" ");
}
