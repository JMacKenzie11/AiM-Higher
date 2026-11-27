import { countTurns } from "./turns";

// IS THE MOMENT REALLY THERE? A judged check that is met must point to
// the words it rests on. This looks for them in the transcript. A
// moment that cannot be found does not count, and the check is then
// not met: the model's reading has to be checkable to be believed.
//
// Matching ignores case, punctuation and spacing, and the speaker
// labels, so "Dana: Thanks, everyone." matches "thanks everyone".
// Recordings break one turn across lines, so the transcript's words
// are joined before searching.

export const MIN_MOMENT_WORDS = 4;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

export function transcriptIndex(transcript: string): string {
  const words = countTurns(transcript).map((t) => t.words).join(" ");
  return ` ${normalize(words)} `;
}

// A moment may differ from the transcript by a word or two: a dropped
// "um", a repeated "the", a word the model tidied. It still counts when
// a run of at least this share of its words appears in the transcript
// in order and unbroken. A paraphrase shares words but not runs.
export const MOMENT_RUN_SHARE = 0.75;

function longestRun(quote: string[], index: string): number {
  let best = 0;
  for (let i = 0; i < quote.length; i++) {
    for (let j = quote.length; j - i > best; j--) {
      if (index.includes(` ${quote.slice(i, j).join(" ")} `)) {
        best = j - i;
        break;
      }
    }
  }
  return best;
}

export function momentFound(moment: string | null | undefined, index: string): boolean {
  if (!moment) return false;
  const m = normalize(moment.replace(/^[^:]{1,60}:\s+/, ""));
  const words = m.split(" ").filter(Boolean);
  if (words.length < MIN_MOMENT_WORDS) return false;
  if (index.includes(` ${m} `)) return true;
  const run = longestRun(words, index);
  return run >= MIN_MOMENT_WORDS && run >= Math.ceil(words.length * MOMENT_RUN_SHARE);
}
