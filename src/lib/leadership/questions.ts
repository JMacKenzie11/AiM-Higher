import type Anthropic from "@anthropic-ai/sdk";
import { VOICE_CORE } from "@/lib/voice/core";
import { stripEmDashes } from "@/lib/voice/strip-dashes";
import { findBannedPhrases, describeHits } from "@/lib/voice/banned";

// QUESTIONS, ON THE COACHING NOTES TAB.
//
// Two blocks, and only one of them is generated.
//
// "Questions that opened things up" is CREDIT for questions picked by
// their EFFECT: the discussion after them went somewhere it was not
// going before (a reframe, a new option, a retired assumption, a gap
// surfaced). Clarifying questions never qualify. Jason, 2026-09-25,
// replacing a version that parsed the summary's own "Key Questions"
// list and so picked by form: it credited "What about sanitation?"
// and missed Darlene's "is anybody using these", which retired the
// scissors.
//
// Each is shown as a lightly cleaned paraphrase, "Casey asked how an
// end buyer would ever come back to Benson directly", never in
// quotation marks, so nothing is presented as verbatim and the
// transcript's stumbles stay off the page; and one plain line on what
// it opened. The model reads the transcript with the settled speaker
// map to judge effect. Code holds the credit: an asker who is not
// among the people identified as present is dropped, not guessed.
//
// "Questions worth asking next week" is generated: three generative
// questions, each tied to something that happened. The rules that
// can be counted are counted after generation, the way the em dashes
// are: under 35 words, no em dashes, no banned phrase, a question
// mark, and none of the diagnostic openings. One retry names what was
// wrong; a question still wrong after it is dropped rather than shown.

// The summary's own quoted questions, still parsed: they tell the
// model which questions were recorded, as a starting point. They are
// no longer what is shown.
export type OpeningQuestion = { question: string; asker: string };

// What the block shows. `asked` completes "<asker> asked ...".
export type OpenedQuestion = { asker: string; asked: string; opened: string };
export type NextWeekQuestion = { question: string; moment: string };

// ---- Credit ---------------------------------------------------------

const KEY_QUESTIONS_HEADING = /key questions that facilitated the discussion/i;

// `- Name: "Q?" (why)` and `- Name, qualifier: "Q?"` and `- "Q?" (Name, why)`.
const NAME_FIRST = /^[-*]\s+(?:\*\*)?([^:"“”*]{2,80}?)(?:\*\*)?:\s*(?:\*\*)?["“]([^"“”]+\?)["”]/;
const QUOTE_FIRST = /^[-*]\s+(?:\*\*)?["“]([^"“”]+\?)["”](?:\*\*)?\s*\(([^,)]+)/;

function cleanAsker(raw: string): string | null {
  // "Casey Benson, checking his own reasoning" and "Casey Benson
  // (implicit reframe)" both credit Casey Benson.
  const name = raw.split(/[,(]/)[0].trim();
  if (!name || /unidentified|speaker|\bteam\b|\bgroup\b/i.test(name)) return null;
  if (!/^[A-Z]/.test(name) || name.split(/\s+/).length > 4) return null;
  return name;
}

export function parseOpeningQuestions(markdown: string): OpeningQuestion[] {
  const out: OpeningQuestion[] = [];
  const seen = new Set<string>();
  let inList = false;
  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (KEY_QUESTIONS_HEADING.test(t)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (t.length === 0) continue;
    if (!/^[-*]\s/.test(t)) {
      inList = false;
      continue;
    }
    let question: string | null = null;
    let asker: string | null = null;
    const a = NAME_FIRST.exec(t);
    const b = a ? null : QUOTE_FIRST.exec(t);
    if (a) {
      asker = cleanAsker(a[1]);
      question = a[2].trim();
    } else if (b) {
      question = b[1].trim();
      asker = cleanAsker(b[2]);
    }
    if (!question || !asker) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ question: stripEmDashes(question), asker });
  }
  return out;
}

// ---- The generated block -------------------------------------------

export const MAX_QUESTION_WORDS = 35;

// Diagnosis, not possibility. Matched at the start, where the frame
// of a question is set.
const DIAGNOSTIC =
  /^(?:why\s+(?:hasn'?t|haven'?t|didn'?t|don'?t|doesn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|can'?t|won'?t|did|do|does|is|are)|what\s+went\s+wrong|what'?s\s+(?:blocking|wrong|stopping)|what\s+is\s+(?:blocking|wrong|stopping)|who\s+(?:dropped|missed|forgot)|how\s+did\s+(?:we|this)\s+(?:miss|fail|let))/i;

export type QuestionFault = { index: number; faults: string[] };

export function questionFaults(q: string): string[] {
  const faults: string[] = [];
  const words = q.trim().split(/\s+/).filter(Boolean).length;
  if (words >= MAX_QUESTION_WORDS) faults.push(`${words} words, needs to be under ${MAX_QUESTION_WORDS}`);
  if (!q.trim().endsWith("?")) faults.push("does not end in a question mark");
  if (DIAGNOSTIC.test(q.trim())) faults.push("opens as a diagnosis, not a possibility");
  const banned = findBannedPhrases(q);
  if (banned.length > 0) faults.push(`uses ${describeHits(banned)}`);
  return faults;
}

// The "From:" line is shown too, so its words are held to the same
// list. "Darlene noticed scissors had quietly disappeared" came through
// when only the question was checked.
export function allFaults(q: NextWeekQuestion): string[] {
  const moment = findBannedPhrases(q.moment);
  return [
    ...questionFaults(q.question),
    ...(moment.length > 0 ? [`its "From" line uses ${describeHits(moment)}`] : []),
  ];
}

const SYSTEM = `You write three questions a leadership team could ask at next week's meeting, drawn from this week's.

A GENERATIVE QUESTION moves a conversation away from problem-solving and toward possibilities, strengths and what the team wants. A diagnostic question keeps the room on the problem.

EACH QUESTION
- Starts from something that worked, or a strength that showed, in THIS meeting, and names that moment plainly in the question itself.
- Points forward.
- Invites the room. It never assigns anyone, and never asks one person to account for something.
- Is framed as possibility ("What would it look like if", "Where else could"), never as diagnosis ("Why hasn't", "What went wrong with", "What's blocking").
- Is under 35 words, one or two short sentences ending in one question mark.

The target, from a real meeting:
  "Nancy's technique spread because she showed it to people. Where else on our floor is someone doing something well that nobody has watched yet?"

For each question also give "moment": the thing that happened in the meeting it is drawn from, in a few plain words.

QUESTIONS THAT OPENED THINGS UP

Separately, find the questions in THIS meeting's transcript that changed where the discussion went. Judge by EFFECT, not by form: a question qualifies only if the discussion after it went somewhere it was not going before. It led to a reframe, a new option, a retired assumption, or a gap surfaced. Read what came after each question before you pick it.

- A clarifying question never qualifies ("Who's on that?", "When?", "What about sanitation?", "Is Nancy the new one?"), however well it was asked.
- A question can be phrased as a statement of doubt ("I don't know if they know...") and still count, if the room took it somewhere.
- Up to four. None, if none qualified. Never pad the list.
- The asker must be someone on the attendee list, named as the list names them. If the speaker map calls the speaker unidentified, leave the question out: credit is the point, and a guess is worse than nothing.
- "asked": a lightly cleaned paraphrase that completes "<first name> asked ...". No quotation marks. Keep their meaning, drop the stumbles.
- "opened": what the discussion did next, in plain words, one short sentence.

Four that qualified, from ANOTHER company's meeting. They show the standard. Never reuse their names, places or details:
  asked: "how an end buyer would ever come back to Benson directly"  opened: "Set the branding inserts' real goal: reaching the buyers behind the brokers."
  asked: "whether the container could be a Grand Manan one that other island businesses join, instead of a Benson one"  opened: "Turned a cost question into a shared island partnership."
  asked: "whether anybody was actually using the scissors"  opened: "Nobody was, so the scissors went, and the knuckle technique spread."
  asked: "whether the Raw crew knows RTE has an incentive"  opened: "Surfaced that the two crews never meet, so Raw may not know."

${VOICE_CORE}`;

const TOOL: Anthropic.Tool = {
  name: "record_questions",
  description: "Record next week's questions and the best questions asked this week.",
  input_schema: {
    type: "object",
    required: ["questions", "opened"],
    properties: {
      questions: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          required: ["moment", "question"],
          properties: {
            moment: { type: "string" },
            question: { type: "string" },
          },
        },
      },
      opened: {
        type: "array",
        maxItems: 4,
        description:
          "Questions from THIS meeting that changed where the discussion went. None if none did.",
        items: {
          type: "object",
          required: ["asker", "asked", "opened"],
          properties: {
            asker: { type: "string", description: "Full name, exactly as the attendee list gives it." },
            asked: {
              type: "string",
              description:
                "Completes the sentence '<first name> asked ...'. A lightly cleaned paraphrase, no quotation marks.",
            },
            opened: { type: "string", description: "What it opened, in plain words. One short sentence." },
          },
        },
      },
    },
  },
};

type RawOut = { questions?: unknown; opened?: unknown };

// The model sometimes returns its whole answer as a JSON STRING inside
// the first field: { questions: "{\"questions\":[...],\"opened\":[...]}" }.
// Seen on the Benson run, 2026-09-25, where it read as "no questions"
// and both blocks came out empty. Unwrapped here, once, for every reader.
export function unwrapRaw(raw: RawOut): RawOut {
  if (typeof raw.questions !== "string") return raw;
  try {
    const inner = JSON.parse(raw.questions) as unknown;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const o = inner as RawOut;
      return { questions: o.questions, opened: raw.opened ?? o.opened };
    }
    if (Array.isArray(inner)) return { questions: inner, opened: raw.opened };
  } catch {
    // Not JSON: leave it, and the readers find nothing.
  }
  return raw;
}

function readQuestions(raw: RawOut): NextWeekQuestion[] {
  if (!Array.isArray(raw.questions)) return [];
  return raw.questions
    .filter((q): q is { question: string; moment?: string } => !!q && typeof (q as { question?: unknown }).question === "string")
    .map((q) => ({
      question: stripEmDashes(q.question.trim()),
      moment: stripEmDashes(typeof q.moment === "string" ? q.moment.trim() : ""),
    }))
    .slice(0, 3);
}

// Credit, held in code. An asker not identified as present is
// dropped rather than guessed; quotation marks come off, because
// nothing here is verbatim; and a line that breaks the voice rules is
// dropped rather than shown.
export function readOpened(raw: { opened?: unknown }, attendees: readonly string[]): OpenedQuestion[] {
  if (!Array.isArray(raw.opened)) return [];
  const byName = new Map(attendees.map((a) => [a.toLowerCase(), a]));
  const firstNames = attendees.map((a) => a.split(/\s+/)[0].toLowerCase());
  const out: OpenedQuestion[] = [];
  for (const item of raw.opened) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.asker !== "string" || typeof o.asked !== "string" || typeof o.opened !== "string") continue;
    const full = byName.get(o.asker.trim().toLowerCase());
    if (!full) {
      console.log(`[questions] opened: dropped, "${o.asker}" is not an identified attendee`);
      continue;
    }
    const first = full.split(/\s+/)[0];
    // First name when it is unique among the attendees, as a person
    // would say it; the full name when two share it.
    const asker = firstNames.filter((f) => f === first.toLowerCase()).length === 1 ? first : full;
    const clean = (t: string) =>
      stripEmDashes(t.replace(/["“”]/g, "").replace(/\s+/g, " ").trim()).replace(/[.?]+$/, "");
    const asked = clean(o.asked).replace(new RegExp(`^${first}\\s+asked\\s+`, "i"), "");
    const opened = clean(o.opened);
    const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
    const banned = [...findBannedPhrases(asked), ...findBannedPhrases(opened)];
    if (!asked || !opened || words(asked) > 30 || words(opened) > 25 || banned.length > 0) {
      console.log(
        `[questions] opened: dropped "${asked}"${banned.length ? `: ${describeHits(banned)}` : ": empty or too long"}`
      );
      continue;
    }
    out.push({ asker, asked, opened: `${opened}.` });
    if (out.length >= 4) break;
  }
  return out;
}

export async function generateMeetingQuestions(
  client: Anthropic,
  input: {
    model: string;
    analysisMarkdown: string;
    strengths: string[];
    asked: OpeningQuestion[];
    // Read to judge what a question actually did. Never shown.
    transcript: string;
    speakerBlock: string;
    // The people identified as present: the only names that may be
    // credited (attendees.ts).
    attendees: string[];
  }
): Promise<{ nextWeek: NextWeekQuestion[]; opened: OpenedQuestion[] }> {
  const asked =
    input.asked.length > 0
      ? input.asked.map((q) => `- ${q.asker}: "${q.question}"`).join("\n")
      : "(none recorded)";
  const strengths =
    input.strengths.length > 0 ? input.strengths.map((s) => `- ${s}`).join("\n") : "(none recorded)";
  const userTurn =
    `What went well, from the facilitation review:\n${strengths}\n\n` +
    `Attendees (the only people who may be credited):\n${
      input.attendees.length > 0 ? input.attendees.map((a) => `- ${a}`).join("\n") : "(none identified)"
    }\n\n` +
    `Questions the summary recorded, a starting point only:\n${asked}\n\n` +
    `<summary>\n${input.analysisMarkdown.slice(0, 14000)}\n</summary>\n\n` +
    `${input.speakerBlock}\n\n<transcript>\n${input.transcript.slice(0, 60000)}\n</transcript>`;

  const ask = async (messages: Anthropic.MessageParam[]): Promise<RawOut> => {
    const res = await client.messages.create({
      model: input.model,
      thinking: { type: "disabled" },
      max_tokens: 1500,
      system: [{ type: "text", text: SYSTEM }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages,
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    return unwrapRaw((block?.input as RawOut) ?? {});
  };

  try {
    const first = await ask([{ role: "user", content: userTurn }]);
    let questions = readQuestions(first);
    let opened = readOpened(first, input.attendees);

    const faulty = questions
      .map((q, index) => ({ index, faults: allFaults(q) }))
      .filter((f) => f.faults.length > 0);
    if (faulty.length > 0 || questions.length < 3) {
      console.log(
        `[questions] retry: ${faulty.map((f) => `#${f.index + 1} ${f.faults.join(", ")}`).join("; ") || "fewer than three"}`
      );
      const instruction =
        `Write all three again. ` +
        faulty
          .map((f) => `Question ${f.index + 1}, "${questions[f.index].question}": ${f.faults.join("; ")}.`)
          .join(" ") +
        ` Keep what was right about the others.`;
      const second = await ask([
        { role: "user", content: userTurn },
        { role: "assistant", content: JSON.stringify({ questions, opened: [] }) },
        { role: "user", content: instruction },
      ]);
      const retried = readQuestions(second);
      if (retried.length > 0) questions = retried;
      // The retry's picks count too. They used to be ignored, so a
      // malformed first answer lost the block even when the retry
      // was fine.
      if (opened.length === 0) opened = readOpened(second, input.attendees);
    }

    // Anything still wrong is dropped, and said so. A block of two
    // good questions beats three with a diagnosis in it.
    const kept = questions.filter((q) => {
      const faults = allFaults(q);
      if (faults.length > 0) {
        console.error(`[questions] dropped after a retry: "${q.question}": ${faults.join("; ")}`);
      }
      return faults.length === 0;
    });
    // Empty is a failure to hear, not a result (failure mode E13):
    // a meeting always has something that went well to ask from.
    if (kept.length === 0) {
      console.error("[questions] no next-week questions survived; the block will be empty");
    }
    return { nextWeek: kept, opened };
  } catch (err) {
    console.error("[questions] generation failed:", err instanceof Error ? err.message : err);
    return { nextWeek: [], opened: [] };
  }
}
