// Is any sentence too long to read in one breath?
//
// ---- WHY A NUMBER AND NOT "SHORT" ------------------------------
//
// The debrief prompt asked for "two or three SHORT sentences" and an
// opener came back at 25, 20, 20 and 30 words. "Short" is a word the
// model agrees with and then measures by its own standard. A count
// is not open to interpretation, so the checker holds the count and
// the prompt states the same number.
//
// ---- WHAT COUNTS AS A SENTENCE ---------------------------------
//
// Split on . ? ! followed by whitespace or the end, and on blank
// lines. Words are whitespace-separated tokens, so a quoted phrase
// counts at its full length: the reader has to get through it too.
// Abbreviations ("e.g. the crew") split early and make a sentence
// look shorter than it is, which errs toward passing, never toward
// a false alarm.

export type LongSentence = { sentence: string; words: number };

export function splitSentences(text: string): string[] {
  return text
    .split(/\n\s*\n|(?<=[.?!]["'”’)]?)\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

export function findLongSentences(
  text: string,
  maxWords: number
): LongSentence[] {
  return splitSentences(text)
    .map((sentence) => ({ sentence, words: sentence.split(" ").length }))
    .filter((s) => s.words > maxWords);
}

// Names the sentences rather than the rule, like the other retries:
// the rule was in the prompt and was already ignored.
export function longSentenceRetryInstruction(
  long: readonly LongSentence[],
  maxWords: number
): string {
  const list = long.map((s) => `"${s.sentence}" (${s.words} words)`).join(", ");
  return (
    `These sentences run over ${maxWords} words: ${list}. Rewrite them ` +
    `so no sentence is longer than ${maxWords} words. Split a long ` +
    `sentence into two, or cut what it does not need.`
  );
}
