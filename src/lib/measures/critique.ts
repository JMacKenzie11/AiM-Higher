import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { MetricValueType, TargetDirection } from "@/lib/types";

// AI-scored quality check for a metric draft on the chart. Judges
// description quality, target quality, and how well the proposed
// metric ties back to its parent Success Measure — one call, three
// hints back. Called from the AddMetricRow on blur or on Add.
//
// The client-safe rule-based layer lives in ./critique-rules.ts so
// it can run on every keystroke without an import chain that pulls
// in the SDK. This file is the "second opinion" layer.
//
// Flag-not-block: every hint is advisory. Best-effort — a missing
// API key, a thrown error, or unparseable output all return null.

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 400;

export type MeasureCritique = {
  descriptionHint: string | null;
  fitHint: string | null;
  targetHint: string | null;
};

const SYSTEM_PROMPT = `You review a proposed metric that will sit under a "success measure" on a leadership team's accountability chart.

You judge three things:

1. Description: is the metric something a leader could actually track weekly? A vague phrase like "Do your best" or "Improve quality" is bad; something like "% of projects shipped on time" or "Average days to first estimate" is good.
2. Target: given the value type (number, percent, or text yes/no) and direction (higher-is-better vs. lower-is-better), is the target clear? "0.95" for a percent-valued metric is unclear; "95%" is clear. "TBD" is bad. A missing target is bad.
3. Fit: does the metric actually measure the parent Success Measure? If the parent is "Meeting client deliverables — on-time / quality" and the metric is "Number of coffees consumed", that's a bad fit.

Return strict JSON in exactly this shape and nothing else — no prose, no code fences:

{"descriptionHint": string|null, "targetHint": string|null, "fitHint": string|null}

Each hint is null when that dimension passes, otherwise a short coaching note (≤160 chars). Keep hints constructive and concrete — suggest a better phrasing where possible. Do not simply repeat back the problem.

Important precedence rule: if the fit is bad, set descriptionHint AND targetHint to null and only return fitHint. Polishing the wording of a metric that measures the wrong thing is worse than useless — the user needs to rethink what they're counting, not sharpen the phrasing. Only critique the metric or target when the metric actually fits the parent Success Measure.`;

export async function scoreMeasureDraft(input: {
  description: string;
  target: string;
  valueType: MetricValueType;
  direction: TargetDirection;
  outcomeTitle: string;
  outcomeDescription: string | null;
}): Promise<MeasureCritique | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.ANTHROPIC_CLARITY_MODEL || DEFAULT_MODEL;

  const client = new Anthropic({ apiKey });
  const userMessage =
    `Parent Success Measure: ${input.outcomeTitle.trim()}\n` +
    (input.outcomeDescription
      ? `Parent context: ${input.outcomeDescription.trim()}\n`
      : "") +
    `\nProposed metric: ${input.description.trim()}\n` +
    `Value type: ${input.valueType}\n` +
    `Direction: ${input.direction === "higher_is_better" ? "higher is better" : "lower is better"}\n` +
    `Target: ${input.target.trim() || "(not set)"}`;

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
    return parseResult(raw);
  } catch (err) {
    console.warn("scoreMeasureDraft failed:", err);
    return null;
  }
}

function parseResult(raw: string): MeasureCritique | null {
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
  return {
    descriptionHint: sanitizeHint(obj.descriptionHint),
    targetHint: sanitizeHint(obj.targetHint),
    fitHint: sanitizeHint(obj.fitHint),
  };
}

function sanitizeHint(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : null;
}
