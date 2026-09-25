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
import {
  findLongSentences,
  longSentenceRetryInstruction,
  type LongSentence,
} from "@/lib/voice/sentences";
import {
  findJoinedQuestions,
  joinedQuestionRetryInstruction,
} from "@/lib/voice/questions";
import {
  findHeadlineRepeat,
  headlineRepeatRetryInstruction,
  type HeadlineRepeat,
} from "./repetition";

// Every check the debrief opener has to pass, in one place, so the
// route asks one question and a test can ask the same one.
//
// The opener is the one turn nobody typed, and it is buffered rather
// than streamed (see route.ts), which is what makes checking it
// before anybody reads it possible at all.

export const OPENER_MAX_WORDS_PER_SENTENCE = 20;

export type OpenerSources = {
  // What was said. Quotes are checked against this. Empty when the
  // session could not read it, and then the summary stands in: its
  // quotation marks are verified against the transcript when it is
  // written (unquoteUnsupported in analyze.ts), so a quote found in
  // it is a quote somebody said.
  transcript: string;
  summary: string;
  // The line in the notification bar, or null when they arrived
  // from the agent list and nothing has been said to them yet.
  headline: string | null;
  // The debrief's limit, which is not every agent's: other practices
  // generate an opener too and were never held to it. Null skips it.
  maxWordsPerSentence: number | null;
};

export type OpenerFaults = {
  invented: UnsupportedQuote[];
  banned: BannedHit[];
  long: LongSentence[];
  joined: string[];
  repeat: HeadlineRepeat | null;
};

export function checkOpener(text: string, src: OpenerSources): OpenerFaults {
  const quoteSource = src.transcript.length > 0 ? src.transcript : src.summary;
  return {
    invented:
      quoteSource.length > 0 ? findUnsupportedQuotes(text, quoteSource) : [],
    banned: findBannedPhrases(text),
    long:
      src.maxWordsPerSentence === null
        ? []
        : findLongSentences(text, src.maxWordsPerSentence),
    joined: findJoinedQuestions(text),
    repeat: findHeadlineRepeat(text, src.headline),
  };
}

// A count, so a retry that fixes three faults and keeps one can be
// preferred to the attempt that had all four. Each fault counts
// once: two banned phrases are two things to fix.
export function faultCount(f: OpenerFaults): number {
  return (
    f.invented.length +
    f.banned.length +
    f.long.length +
    f.joined.length +
    (f.repeat ? 1 : 0)
  );
}

// For the log: what is wrong, where, in one line.
export function describeFaults(f: OpenerFaults): string {
  return [
    f.invented.length > 0
      ? `invented quote(s) ${f.invented.map((q) => `"${q.quote}"`).join(", ")}`
      : null,
    f.repeat
      ? `repeats the headline (event: ${f.repeat.sharedEvent.join(", ")}; question: ${f.repeat.sharedQuestion.join(", ")})`
      : null,
    f.long.length > 0
      ? `long sentence(s) ${f.long.map((s) => `${s.words} words`).join(", ")}`
      : null,
    f.joined.length > 0 ? `two questions joined by "and"` : null,
    f.banned.length > 0 ? describeHits(f.banned) : null,
  ]
    .filter(Boolean)
    .join("; ");
}

// Most serious first. An invented quote hands somebody a false record
// of their own meeting; a repeat wastes the one turn they opened the
// chat for; the rest are style.
export function openerRetryInstruction(
  f: OpenerFaults,
  headline: string | null
): string {
  return [
    f.invented.length > 0 ? quoteRetryInstruction(f.invented) : null,
    f.repeat && headline ? headlineRepeatRetryInstruction(headline) : null,
    f.long.length > 0
      ? longSentenceRetryInstruction(f.long, OPENER_MAX_WORDS_PER_SENTENCE)
      : null,
    f.joined.length > 0 ? joinedQuestionRetryInstruction(f.joined) : null,
    f.banned.length > 0 ? retryInstruction(f.banned) : null,
  ]
    .filter(Boolean)
    .join(" ");
}
