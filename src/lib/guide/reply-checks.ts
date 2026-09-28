import { findBannedPhrases, type BannedHit } from "@/lib/voice/banned";

// WHAT A DEBRIEF REPLY GOT WRONG, for the log.
//
// The opener is checked and sent back (opener-checks.ts). Every reply
// after it streams to the champion as it is written, so there is
// nothing to send back: this names what broke a rule, and the route
// logs it. Measure first. Rewriting a reply that is already on the
// champion's screen is a bigger change, and worth making only if these
// lines say it happens often.
//
// Found on dev, 2026-09-28, the second turn of the first debrief:
// "a quiet, sensible guess instead of one person asking out loud"
// (the banned "X instead of Y") and "Nobody had a bad intent here"
// (affirming by denying the opposite).

// Reassurance by denying the opposite. Narrow on purpose: it only
// logs, and a pattern that fires on ordinary sentences would bury the
// real ones.
const DENIALS: ReadonlyArray<RegExp> = [
  /\b(?:nobody|no one|no-one)\s+(?:had|meant|was)\s+(?:a\s+)?(?:bad|ill|wrong)\b[^.?!]*/gi,
  /\b(?:that|this|it)(?:'s|’s|\s+is|\s+was)\s+not\s+(?:a\s+)?(?:small|little|minor|nothing)\b[^.?!]*/gi,
  /\bthis\s+(?:isn't|isn’t|is\s+not)\s+about\s+blame\b[^.?!]*/gi,
];

export function debriefReplyFaults(text: string): BannedHit[] {
  const hits = findBannedPhrases(text);
  for (const re of DENIALS) {
    for (const m of text.matchAll(re)) {
      hits.push({ phrase: "affirming by denial", context: m[0].trim() });
    }
  }
  return hits;
}
