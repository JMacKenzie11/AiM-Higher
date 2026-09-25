import type Anthropic from "@anthropic-ai/sdk";
import { VOICE_CORE } from "@/lib/voice/core";
import { stripEmDashes } from "@/lib/voice/strip-dashes";
import { findBannedPhrases, describeHits } from "@/lib/voice/banned";

// QUESTIONS, ON THE COACHING NOTES TAB.
//
// Two blocks, and only one of them is generated.
//
// "Questions that opened things up" is CREDIT: the best two or three
// of the questions people actually asked, with who asked. Nothing is
// written here. The candidates are parsed out of the summary's own
// "Key Questions That Facilitated the Discussion" lists, a question
// only counts while it is still in quotation marks (the summary's
// quotes are checked against the transcript when it is written, see
// unquoteUnsupported), and the model is only asked to pick among
// them by number. It cannot reword a question or move the credit.
//
// "Questions worth asking next week" is generated: three generative
// questions, each tied to something that happened. The rules that
// can be counted are counted after generation, the way the em dashes
// are: under 35 words, no em dashes, no banned phrase, a question
// mark, and none of the diagnostic openings. One retry names what was
// wrong; a question still wrong after it is dropped rather than shown.

export type OpeningQuestion = { question: string; asker: string };
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

You are also given a numbered list of questions people asked in the meeting. Pick the two or three that did the most to open the conversation up, by number. Pick none if none did.

${VOICE_CORE}`;

const TOOL: Anthropic.Tool = {
  name: "record_questions",
  description: "Record next week's questions and the best questions asked this week.",
  input_schema: {
    type: "object",
    required: ["questions", "best_asked"],
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
      best_asked: {
        type: "array",
        maxItems: 3,
        items: { type: "integer", minimum: 1 },
        description: "Numbers from the list of questions asked, best first.",
      },
    },
  },
};

type RawOut = { questions?: unknown; best_asked?: unknown };

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

function readPicks(raw: RawOut, count: number): number[] {
  if (!Array.isArray(raw.best_asked)) return [];
  const picks: number[] = [];
  for (const n of raw.best_asked) {
    if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= count && !picks.includes(n)) picks.push(n);
  }
  return picks.slice(0, 3);
}

export async function generateMeetingQuestions(
  client: Anthropic,
  input: {
    model: string;
    analysisMarkdown: string;
    strengths: string[];
    asked: OpeningQuestion[];
  }
): Promise<{ nextWeek: NextWeekQuestion[]; opened: OpeningQuestion[] }> {
  const asked =
    input.asked.length > 0
      ? input.asked.map((q, i) => `${i + 1}. ${q.asker}: "${q.question}"`).join("\n")
      : "(none recorded)";
  const strengths =
    input.strengths.length > 0 ? input.strengths.map((s) => `- ${s}`).join("\n") : "(none recorded)";
  const userTurn =
    `What went well, from the facilitation review:\n${strengths}\n\n` +
    `Questions people asked in the meeting:\n${asked}\n\n` +
    `<summary>\n${input.analysisMarkdown.slice(0, 14000)}\n</summary>`;

  const ask = async (messages: Anthropic.MessageParam[]): Promise<RawOut> => {
    const res = await client.messages.create({
      model: input.model,
      thinking: { type: "disabled" },
      max_tokens: 800,
      system: [{ type: "text", text: SYSTEM }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages,
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    return (block?.input as RawOut) ?? {};
  };

  try {
    const first = await ask([{ role: "user", content: userTurn }]);
    let questions = readQuestions(first);
    const opened = readPicks(first, input.asked.length).map((n) => input.asked[n - 1]);

    const faulty = questions
      .map((q, index) => ({ index, faults: questionFaults(q.question) }))
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
        { role: "assistant", content: JSON.stringify({ questions, best_asked: [] }) },
        { role: "user", content: instruction },
      ]);
      const retried = readQuestions(second);
      if (retried.length > 0) questions = retried;
    }

    // Anything still wrong is dropped, and said so. A block of two
    // good questions beats three with a diagnosis in it.
    const kept = questions.filter((q) => {
      const faults = questionFaults(q.question);
      if (faults.length > 0) {
        console.error(`[questions] dropped after a retry: "${q.question}": ${faults.join("; ")}`);
      }
      return faults.length === 0;
    });
    return { nextWeek: kept, opened };
  } catch (err) {
    console.error("[questions] generation failed:", err instanceof Error ? err.message : err);
    return { nextWeek: [], opened: [] };
  }
}
