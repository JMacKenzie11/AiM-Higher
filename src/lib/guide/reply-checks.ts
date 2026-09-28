import { findBannedPhrases, type BannedHit } from "@/lib/voice/banned";
import { findUnsupportedQuotes } from "@/lib/voice/quotes";

// WHAT A DEBRIEF REPLY GOT WRONG, for the log.
//
// The debrief's first turn is the invitation's own line, checked when
// it was raised (guide/headline.ts). Every reply after it streams to
// the champion as it is written, so there is nothing to send back: this names what broke a rule, and the route
// logs it. Measure first. Rewriting a reply that is already on the
// champion's screen is a bigger change, and worth making only if these
// lines say it happens often.
//
// Found on dev, 2026-09-28, the second turn of the first debrief:
// "a quiet, sensible guess instead of one person asking out loud"
// (the banned "X instead of Y") and "Nobody had a bad intent here"
// (affirming by denying the opposite). And, the day the debrief began
// opening with the invitation's line, a reply that put "who screwed up
// the schedule this time" in quotation marks: nobody said it. A quote
// hands the leader a false record of their own meeting, so it is
// checked against what was said, the transcript, read by the route
// under the champion's own session and never shown to the model.

// Reassurance by denying the opposite. Narrow on purpose: it only
// logs, and a pattern that fires on ordinary sentences would bury the
// real ones.
const DENIALS: ReadonlyArray<RegExp> = [
  /\b(?:nobody|no one|no-one)\s+(?:had|meant|was)\s+(?:a\s+)?(?:bad|ill|wrong)\b[^.?!]*/gi,
  /\b(?:that|this|it)(?:'s|’s|\s+is|\s+was)\s+not\s+(?:a\s+)?(?:small|little|minor|nothing)\b[^.?!]*/gi,
  /\bthis\s+(?:isn't|isn’t|is\s+not)\s+about\s+blame\b[^.?!]*/gi,
];

export function debriefReplyFaults(text: string, transcript: string): BannedHit[] {
  const hits = findBannedPhrases(text);
  if (transcript.length > 0) {
    for (const q of findUnsupportedQuotes(text, transcript)) {
      hits.push({ phrase: "invented quote", context: q.quote });
    }
  }
  for (const re of DENIALS) {
    for (const m of text.matchAll(re)) {
      hits.push({ phrase: "affirming by denial", context: m[0].trim() });
    }
  }
  return hits;
}
