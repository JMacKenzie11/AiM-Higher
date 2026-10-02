import type Anthropic from "@anthropic-ai/sdk";
import { ANONYMITY_RULE, type AnonymityFault, type Anonymiser } from "@/lib/aimee/anonymise";

// ONE CONVERSATION, SUMMARISED ANONYMOUSLY, for the coaching insights
// card (/api/cron/coaching-insights). Moved out of the route so the
// anonymous rule can be tested.
//
// The transcript arrives already scrubbed (aimee/anonymise.ts). The
// answer is checked before it is stored: anything naming somebody, a
// role one person holds, or a personal detail is sent back once,
// naming the fault, and whatever still breaks the rule is dropped. A
// dropped summary is stored empty (the column is not nullable) and the
// dashboard shows none; the topics and friction level, which carry no
// names, still count.

export const INSIGHTS_PROMPT_VERSION = 2;

export type AnalysisPayload = {
  summary: string;
  topics: string[];
  friction_level: 0 | 1 | 2 | 3;
  friction_signal: string | null;
  opportunity: string | null;
};

export type AnonymousAnalysis = {
  payload: AnalysisPayload;
  retried: boolean;
  // What was still wrong after the retry, and so dropped. Labels only.
  dropped: AnonymityFault[];
};

function prompt(transcript: string): string {
  return `You are analyzing a workplace leadership coaching conversation. Return a structured summary that AiMS reads, anonymously, to improve its coaching.

ANONYMITY (non-negotiable): ${ANONYMITY_RULE} Names in the transcript have already been replaced with "a colleague" and "the company". Use generic terms: "the leader", "a report", "a peer", "a manager", "a client", "a supplier", "the product", "a site".

Return ONLY a JSON object matching this schema, no code fences, no prose:
{
  "summary": "one plain sentence: what the leader was working on",
  "topics": ["1-4 short tags in plain business language"],
  "friction_level": 0,
  "friction_signal": null,
  "opportunity": null
}

friction_level scale:
 0 = informational / neutral (asking a question, exploring)
 1 = mild friction (some tension but making progress)
 2 = frustrated (stuck on a specific issue, expressing frustration)
 3 = stuck (repeated attempts, blocked, escalated)

friction_signal: if level >= 1, a short phrase naming the friction (e.g. "unclear priorities", "accountability gap"). Otherwise null.

opportunity: if the conversation surfaces a platform-product opportunity (a feature that would help), a short phrase. Otherwise null.

topics: 1-4 short tags in plain business language, not therapy-speak, not consultant jargon.

Transcript:
${transcript}`;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// Models wrap JSON in fences even when told not to.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json|JSON)?\s*/, "").replace(/```$/, "").trim();
}

export function parseAnalysis(text: string): AnalysisPayload {
  const parsed = JSON.parse(stripCodeFence(text)) as Partial<AnalysisPayload>;
  if (typeof parsed.summary !== "string" || parsed.summary.length === 0) {
    throw new Error("analysis: missing summary");
  }
  if (!Array.isArray(parsed.topics)) throw new Error("analysis: missing topics");
  const topics = parsed.topics
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .slice(0, 4);
  const rawLevel = typeof parsed.friction_level === "number" ? parsed.friction_level : 0;
  const friction_level = Math.max(0, Math.min(3, Math.round(rawLevel))) as 0 | 1 | 2 | 3;
  const friction_signal =
    friction_level > 0 && typeof parsed.friction_signal === "string"
      ? parsed.friction_signal.trim().slice(0, 120) || null
      : null;
  const opportunity =
    typeof parsed.opportunity === "string" && parsed.opportunity.trim().length > 0
      ? parsed.opportunity.trim().slice(0, 200)
      : null;
  return { summary: parsed.summary.trim().slice(0, 500), topics, friction_level, friction_signal, opportunity };
}

function faultsIn(p: AnalysisPayload, anon: Anonymiser): AnonymityFault[] {
  const all = [p.summary, p.friction_signal ?? "", p.opportunity ?? "", ...p.topics].flatMap((t) => anon.faults(t));
  return [...new Set(all)];
}

// Keeps what passes: the summary emptied, a signal or opportunity
// nulled, a topic removed, each only if it breaks the rule.
function dropFaulty(p: AnalysisPayload, anon: Anonymiser): AnalysisPayload {
  const clean = (t: string | null) => (t && anon.faults(t).length === 0 ? t : null);
  return {
    summary: anon.faults(p.summary).length === 0 ? p.summary : "",
    topics: p.topics.filter((t) => anon.faults(t).length === 0),
    friction_level: p.friction_level,
    friction_signal: clean(p.friction_signal),
    opportunity: clean(p.opportunity),
  };
}

export async function analyzeConversation(
  client: Anthropic,
  model: string,
  scrubbedTranscript: string,
  anon: Anonymiser,
  onMessage?: (m: Anthropic.Message) => void
): Promise<AnonymousAnalysis> {
  const ask: Anthropic.MessageParam[] = [{ role: "user", content: prompt(scrubbedTranscript) }];
  const first = await client.messages.create({ model, max_tokens: 400, messages: ask });
  onMessage?.(first);
  let payload = parseAnalysis(textOf(first));
  let faults = faultsIn(payload, anon);
  if (faults.length === 0) return { payload, retried: false, dropped: [] };

  const second = await client.messages.create({
    model,
    max_tokens: 400,
    messages: [
      ...ask,
      { role: "assistant", content: textOf(first) },
      {
        role: "user",
        content: `Your answer contains ${faults.join(" and ")}. Return the same JSON with it left out, following the anonymity rule.`,
      },
    ],
  });
  onMessage?.(second);
  try {
    const retried = parseAnalysis(textOf(second));
    const retriedFaults = faultsIn(retried, anon);
    if (retriedFaults.length < faults.length || retriedFaults.length === 0) {
      payload = retried;
      faults = retriedFaults;
    }
  } catch {
    // A retry that does not parse leaves the first answer, cleaned.
  }
  return { payload: dropFaulty(payload, anon), retried: true, dropped: faults };
}
