import { splitSentences } from "@/lib/voice/sentences";

// Does the opener say the headline again?
//
// ---- WHY THIS IS A CHECK AND NOT A PROMPT RULE -----------------
//
// The debrief prompt already said: they have read the headline, so
// build on it. An opener still came back telling the champion about
// the Tuesday collision and the calendar owner, the exact event the
// headline had just named, and ended on the headline's own question
// ("what made it possible" against "what made it work"). The rule
// was in the prompt and was ignored, which is the pattern every
// other check in src/lib/voice exists for.
//
// ---- WHAT "THE SAME" MEANS HERE --------------------------------
//
// Deterministic, so it is measured in words rather than judged.
// Two things must BOTH be true, because either alone is ordinary:
// an opener may name the same event to ask something new about it,
// and may ask a similar question about a different moment.
//
//   SAME EVENT     the opener's statements share at least three
//                  content words with the headline's statements.
//   SAME QUESTION  the opener's question shares at least two content
//                  words with the headline, or both questions ask
//                  what made something work.
//
// Content words are lowercased, stripped of a plural or tense
// ending, and exclude a stop list, so "owned" and "owns" meet and
// "the" and "that" never count. The thresholds are set from the
// real pair: that opener shared four words of event (tuesday,
// third, calendar, own) and four of question (calendar, gap, third,
// made-it). An opener about the champion's own commitments, or
// about a decision nobody took on, shares none.

export type HeadlineRepeat = {
  sharedEvent: string[];
  sharedQuestion: string[];
};

const STOP = new Set(
  (
    "a about after again all also am an and any are as at be been before " +
    "being but by can could did do does doing done each even ever for " +
    "from get got had has have having he her here him his how i if in " +
    "into is it its just last let like look made make makes making me " +
    "more most much my next no not now of off on one only or other our " +
    "out over really said say same see she should so some still " +
    "such take than that the their them then there these they thing " +
    "things think this those through time to too two up us very want " +
    "was way we week well were what when where which while who why will " +
    "with worth would yes you your"
  ).split(" ")
);

export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []) {
    const word = raw.replace(/'s$/, "").replace(/['-]/g, "");
    if (word.length < 3 || STOP.has(word)) continue;
    out.add(stem(word));
  }
  return out;
}

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

// "What made it work", "what made that possible", "what let the
// team do it": the retrospective question the headline almost always
// ends on, because its prompt gives that as the example.
const WHAT_MADE_IT =
  /\bwhat\s+(?:do\s+you\s+think\s+)?(?:made|let|helped|allowed|enabled)\b/i;

function split(text: string): { statements: string; question: string } {
  const sentences = splitSentences(text);
  const questions = sentences.filter((s) => s.endsWith("?"));
  return {
    statements: sentences.filter((s) => !s.endsWith("?")).join(" "),
    question: questions[questions.length - 1] ?? "",
  };
}

function shared(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((w) => b.has(w));
}

export function findHeadlineRepeat(
  opener: string,
  headline: string | null | undefined
): HeadlineRepeat | null {
  if (!headline) return null;
  const o = split(opener);
  const h = split(headline);

  const sharedEvent = shared(
    contentWords(o.statements),
    contentWords(h.statements)
  );
  if (sharedEvent.length < 3) return null;

  const sharedQuestion = shared(
    contentWords(o.question),
    contentWords(headline)
  );
  const sameShape =
    WHAT_MADE_IT.test(o.question) && WHAT_MADE_IT.test(h.question);
  if (sharedQuestion.length < 2 && !sameShape) return null;

  return {
    sharedEvent,
    sharedQuestion: sameShape
      ? [...sharedQuestion, "(both ask what made it work)"]
      : sharedQuestion,
  };
}

// Says what to do rather than only what was wrong, and names the
// ground the opener should look at instead. Not the champion's own
// commitments as a subject: asking how a task from this meeting is
// going is a status check, and the debrief is not one.
export function headlineRepeatRetryInstruction(headline: string): string {
  return (
    `They have already read this line, and your turn says it again: ` +
    `"${headline}". Start from something new in the summary. Good ` +
    `places to look: a decision the meeting made that nobody took on, ` +
    `or another moment that showed how the team works. Their own ` +
    `commitments can be context, never a question about how they are ` +
    `going. Do not mention the line they read, and do not ask what ` +
    `made the same moment work.`
  );
}
