import type Anthropic from "@anthropic-ai/sdk";
import { requestJson, transcriptModel } from "@/lib/transcripts/model";

// DOES AN AGENT'S PROMPT PULL AGAINST THE AiMS COACHING PRINCIPLES?
// (coaching principles project, part 4; Jason, 2026-09-30 and 10-02.)
//
// The principles come after every agent's prompt and win where the
// two disagree (prompts/aims-coaching-principles.md, first paragraph).
// An agent written against them still costs something: the model is
// handed two instructions that point different ways, and which one it
// follows on a given turn is luck. So publishing an agent in the Hub
// checks its prompt first and lists what pulls the other way.
//
// IT WARNS, IT NEVER BLOCKS. Some agents work with problems by design
// ("Prepare a hard conversation"), and the person publishing knows
// things a check does not. A system admin can publish with warnings by
// giving a reason, which is kept with the version (0256).
//
// ---- WHY A MODEL AND NOT PATTERNS -------------------------------
//
// Tried first, on the seven code prompts and production's live Hub
// version: every phrase a keyword rule caught ("diagnosis", "root
// cause", "diagnostic") sat in a sentence telling the coach NOT to do
// it ("never a diagnosis", "not root cause"). Telling the two apart is
// reading, so a model reads it, and the code holds it to what it can
// check: each warning must quote the prompt word for word and name a
// principle that exists. A warning that fails either is dropped.

export type PrinciplesConflict = {
  // A principle's heading, as in the principles file.
  principle: string;
  // Copied from the agent's prompt, word for word.
  quote: string;
  // One sentence: how the two pull apart.
  why: string;
};

export type PrinciplesCheck =
  | { status: "checked"; conflicts: PrinciplesConflict[] }
  // The check could not run (no key, a timeout, an unreadable answer).
  // Treated like a warning: publishing still needs a reason.
  | { status: "failed"; conflicts: [] };

const MAX_CONFLICTS = 10;

// The headings of the principles file ("## Ask one question at a time").
export function principleHeadings(principles: string): string[] {
  return [...principles.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
}

const SYSTEM = `You review the instructions for one AI coaching agent against the AiMS coaching principles. At runtime the principles come after the agent's instructions and win where the two disagree, but an instruction that pulls against a principle still confuses the coach.

List each instruction in the agent's text that tells the coach to act against a principle. For each:
- "principle": the principle's heading, exactly as written in the principles.
- "quote": the instruction, copied from the agent's text word for word: one continuous span, short, never paraphrased or joined with "...".
- "why": one plain sentence saying how the instruction and the principle pull apart.

Do not list:
- an instruction that agrees with a principle, or that forbids what a principle forbids ("never diagnose", "don't rank people" agree);
- the agent's subject. An agent that helps with a hard conversation or a problem is not in conflict for that alone; only an instruction about how to coach can be;
- wording, tone or formatting, unless a principle is about it.

When nothing pulls against a principle, return an empty list. Most well-written agents have few or none.`;

const SCHEMA = {
  type: "object",
  properties: {
    conflicts: {
      type: "array",
      maxItems: MAX_CONFLICTS,
      items: {
        type: "object",
        properties: {
          principle: { type: "string" },
          quote: { type: "string" },
          why: { type: "string" },
        },
        required: ["principle", "quote", "why"],
      },
    },
  },
  required: ["conflicts"],
};

const squash = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

// What the model answered, held to what code can check: a principle
// that exists, a quote that is in the prompt. Anything else is dropped.
export function readConflicts(data: unknown, prompt: string, headings: readonly string[]): PrinciplesConflict[] | null {
  if (!data || typeof data !== "object" || !Array.isArray((data as { conflicts?: unknown }).conflicts)) return null;
  const inPrompt = squash(prompt);
  const byHeading = new Map(headings.map((h) => [h.toLowerCase(), h]));
  const out: PrinciplesConflict[] = [];
  for (const c of (data as { conflicts: unknown[] }).conflicts) {
    if (!c || typeof c !== "object") continue;
    const { principle, quote, why } = c as Record<string, unknown>;
    if (typeof principle !== "string" || typeof quote !== "string" || typeof why !== "string") continue;
    const heading = byHeading.get(principle.trim().toLowerCase());
    const q = quote.trim().replace(/^["“]|["”]$/g, "");
    if (!heading || q.length < 4 || !inPrompt.includes(squash(q)) || !why.trim()) continue;
    out.push({ principle: heading, quote: q, why: why.trim() });
  }
  return out.slice(0, MAX_CONFLICTS);
}

export async function checkAgentPrompt(
  client: Anthropic,
  prompt: string,
  principles: string,
  onUsage?: (usage: Anthropic.Usage) => void
): Promise<PrinciplesCheck> {
  try {
    const { data, message } = await requestJson(client, {
      model: transcriptModel(),
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `<principles>\n${principles}\n</principles>\n\n<agent_instructions>\n${prompt}\n</agent_instructions>`,
        },
      ],
      schema: SCHEMA,
      max_tokens: 4000,
    });
    onUsage?.(message.usage);
    const conflicts = readConflicts(data, prompt, principleHeadings(principles));
    return conflicts ? { status: "checked", conflicts } : { status: "failed", conflicts: [] };
  } catch {
    return { status: "failed", conflicts: [] };
  }
}
