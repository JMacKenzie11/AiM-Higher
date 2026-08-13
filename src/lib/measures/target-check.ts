import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { logCoachTokenUsage } from "@/lib/coach/usage";
import type { MetricValueType, TargetDirection } from "@/lib/types";

// AI-scored quality check on a success-measure target. Called from
// createMeasureAction / updateMeasureAction when Performance
// Tracking is on for the company. Returns a short coaching hint
// when the target could be sharper — vague ("do well"), not
// numeric ("as much as possible"), missing units, or contradicting
// the stated direction ("keep defect rate high" with lower-is-
// better direction). Returns null when the target passes.
//
// Best-effort: a missing API key, a thrown error, or unparseable
// output all return null. The save always succeeds; the hint is a
// nice-to-have coaching signal, not a permission gate.

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 300;

const SYSTEM_PROMPT = `You review a target set on a work performance measure and decide whether the target is clear enough to be useful.

A good target is:
- Specific: a concrete number or observable state, not "improve" or "as much as possible".
- Consistent with the value type (a percent target for a percent-valued measure, a number target for a number-valued measure).
- Consistent with the stated direction: higher-is-better should read as a floor to reach or exceed; lower-is-better should read as a ceiling to stay under.

Return strict JSON in exactly this shape and nothing else — no prose, no code fences:

{"ok": boolean, "hint": string|null}

If the target is clear, set ok=true and hint=null. If not, set ok=false and provide a short coaching hint (≤160 chars) suggesting a sharper target. Keep the hint constructive, not punitive.`;

export type TargetCheckResult = { ok: boolean; hint: string | null };

export async function scoreMeasureTarget(input: {
  description: string;
  target: string;
  valueType: MetricValueType;
  direction: TargetDirection;
}): Promise<TargetCheckResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.ANTHROPIC_CLARITY_MODEL || DEFAULT_MODEL;

  const client = new Anthropic({ apiKey });
  const userMessage =
    `Measure: ${input.description.trim()}\n` +
    `Value type: ${input.valueType}\n` +
    `Direction: ${input.direction === "higher_is_better" ? "higher is better" : "lower is better"}\n` +
    `Target: ${input.target.trim()}`;

  try {
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT }],
      messages: [{ role: "user", content: userMessage }],
    });
    if (res.usage) {
      void logCoachTokenUsage({
        conversationId: null,
        companyId: null,
        purpose: "clarity",
        model,
        usage: res.usage,
      });
    }
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseResult(raw);
  } catch (err) {
    console.warn("scoreMeasureTarget failed:", err);
    return null;
  }
}

function parseResult(raw: string): TargetCheckResult | null {
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
  if (typeof obj.ok !== "boolean") return null;
  const hint =
    typeof obj.hint === "string"
      ? obj.hint.trim().slice(0, 200) || null
      : null;
  return { ok: obj.ok, hint };
}
