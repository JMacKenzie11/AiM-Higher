import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// Auto-score a single commitment against the three AiMS clarity
// criteria and (when any fails) return a short refinement note.
//
// Used by createCommitmentAction so hand-typed commitments get the
// same feedback as analyzer-extracted ones — a two-word "Test"
// lands with three amber flags and a suggested rewrite instead of
// sliding through unassessed.
//
// Failure is silent: if the API key is missing, the model returns
// junk, or the call throws, we return null and the row stays
// unassessed. The clarity dot stays grey and the user can toggle
// manually. Better to let the save succeed than to fail the flow
// on an ancillary AI call.

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 400;

export type ClarityScore = {
  deliverable: boolean;
  timeline: boolean;
  success: boolean;
  note: string | null;
};

const SYSTEM_PROMPT = `You score a single work commitment against three clarity criteria and return strict JSON.

The criteria (each is a boolean, judged from the commitment text alone — do not assume information not stated):
- deliverable: TRUE only when the commitment clearly names what will be delivered. Vague verbs like "look into", "think about", "explore", "review" without a specific artefact are FALSE.
- timeline:    TRUE when a specific deadline is stated or implied by the commitment text OR when the caller provides a due_date. "Soon", "next few weeks" with no due_date is FALSE.
- success:     TRUE when the commitment names an observable outcome or artefact that will show the work is done. Absent, FALSE.

When any of the three is FALSE, provide a short refinement note (≤160 chars) that rewrites the commitment to satisfy all three. When all three are TRUE, set note to null.

Return strict JSON in exactly this shape and nothing else — no prose, no code fences:

{"deliverable": boolean, "timeline": boolean, "success": boolean, "note": string|null}`;

export async function scoreCommitmentClarity(
  description: string,
  dueDate: string | null
): Promise<ClarityScore | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.ANTHROPIC_CLARITY_MODEL || DEFAULT_MODEL;

  const client = new Anthropic({ apiKey });
  const userMessage = dueDate
    ? `Commitment: ${description.trim()}\nDue date: ${dueDate}`
    : `Commitment: ${description.trim()}\nDue date: (not set)`;

  try {
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT }],
      messages: [{ role: "user", content: userMessage }],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseScore(raw);
  } catch (err) {
    console.warn("scoreCommitmentClarity failed:", err);
    return null;
  }
}

function parseScore(raw: string): ClarityScore | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const deliverable =
    typeof obj.deliverable === "boolean" ? obj.deliverable : null;
  const timeline = typeof obj.timeline === "boolean" ? obj.timeline : null;
  const success = typeof obj.success === "boolean" ? obj.success : null;
  if (deliverable === null || timeline === null || success === null) {
    return null;
  }
  const note =
    typeof obj.note === "string" ? obj.note.trim().slice(0, 200) || null : null;
  return { deliverable, timeline, success, note };
}
