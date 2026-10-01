import type Anthropic from "@anthropic-ai/sdk";

// THE MODEL THAT READS A MEETING'S TRANSCRIPT, AND HOW IT IS ASKED.
//
// Every call on a meeting uses it: the speaker map, the summary, the
// extraction, the facilitation review, the coverage check, the meeting
// questions, the invitation card, and the rewording of a meeting's
// items. One place, so they cannot drift apart, and so the scripts that
// act on the pipeline's output use it too
// (scripts/propose-summary-redactions.ts).
//
// Claude Opus 5.5 from 2026-10-01 (Jason). ANTHROPIC_SUMMARY_MODEL
// overrides it everywhere; ANTHROPIC_FACILITATION_MODEL overrides the
// review alone. Neither is set on Vercel.
const DEFAULT_MODEL = "claude-opus-5-5";

export function transcriptModel(): string {
  return process.env.ANTHROPIC_SUMMARY_MODEL || DEFAULT_MODEL;
}

// ---- THINKING ------------------------------------------------------
//
// Probed against the API on 2026-10-01: Opus 5.5 refuses
// `thinking: { type: "disabled" }` ("Use thinking.type.adaptive and
// output_config.effort to control thinking behavior") and refuses a
// forced tool_choice of "tool" or "any". Its lowest setting is
// `output_config.effort: "low"` (no "none" or "minimal"). Sonnet 5
// accepts thinking disabled, as the pipeline has always asked.
//
// Jason, 2026-10-01: thinking on Opus at the lowest possible setting.
// So a call that should not think gets thinking off where the model
// allows it, and effort "low" where it does not; a call that needs to
// think (the invitation card) gets adaptive thinking, still at "low"
// on Opus.
const NO_DISABLED_THINKING = /^claude-opus-5-5/;

export type Thinking = "off" | "adaptive";

type Settings = Pick<Anthropic.MessageCreateParamsNonStreaming, "thinking" | "output_config">;

export function callSettings(
  model: string,
  thinking: Thinking,
  format?: Anthropic.JSONOutputFormat
): Settings {
  const lowest = NO_DISABLED_THINKING.test(model);
  const settings: Settings = {};
  if (thinking === "adaptive") settings.thinking = { type: "adaptive" };
  else if (!lowest) settings.thinking = { type: "disabled" };
  if (lowest || format) {
    settings.output_config = {
      ...(lowest ? { effort: "low" as const } : {}),
      ...(format ? { format } : {}),
    };
  }
  return settings;
}

// ---- JSON OUT ------------------------------------------------------
//
// The pipeline used to get structured answers by forcing a tool call
// (tool_choice "tool") and reading the tool's input. Opus 5.5 does not
// allow that, so a call that wants JSON asks for it with structured
// output (output_config.format, json_schema), which both models accept,
// and reads the text back as JSON. The schema is the same one the tool
// carried. Each caller still validates what it gets: a schema shapes
// the answer, it does not make it true.

export type JsonRequest = {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  schema: Record<string, unknown>;
  max_tokens: number;
  thinking?: Thinking;
};

// Structured output has rules of its own (probed 2026-10-01): every
// object must close its properties (additionalProperties: false), an
// array may not carry maxItems or minItems above 1, and a number may
// not carry minimum or maximum. They are rules
// of the output API rather than of the shapes, so they are applied
// here, the one place that talks to it, and the schemas stay the
// domain's shapes. A list limit is moved into the field's description,
// which is what it was under the forced tool call: guidance the model
// read, never enforced by the API. Exported for its test.
export function forStructuredOutput(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(forStructuredOutput);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = forStructuredOutput(v);
  const types = Array.isArray(out.type) ? out.type : [out.type];
  if (types.includes("object")) out.additionalProperties = false;
  if (types.includes("array")) {
    const min = typeof out.minItems === "number" ? out.minItems : null;
    const max = typeof out.maxItems === "number" ? out.maxItems : null;
    const limits: string[] = [];
    if (min !== null && min > 1) {
      limits.push(max === min ? `Exactly ${min} items.` : `At least ${min} items.`);
      delete out.minItems;
    }
    if (max !== null) {
      if (min === null || min <= 1 || max !== min) limits.push(`At most ${max} items.`);
      delete out.maxItems;
    }
    if (limits.length > 0) {
      out.description = [out.description, ...limits].filter(Boolean).join(" ");
    }
  }
  // A number's range, likewise: "From 1 to 5." in the description.
  if (types.includes("integer") || types.includes("number")) {
    const lo = typeof out.minimum === "number" ? out.minimum : null;
    const hi = typeof out.maximum === "number" ? out.maximum : null;
    if (lo !== null || hi !== null) {
      const range = lo !== null && hi !== null ? `From ${lo} to ${hi}.` : lo !== null ? `At least ${lo}.` : `At most ${hi}.`;
      out.description = [out.description, range].filter(Boolean).join(" ");
      delete out.minimum;
      delete out.maximum;
    }
  }
  return out;
}

export async function requestJson(
  client: Anthropic,
  req: JsonRequest
): Promise<{ data: unknown; message: Anthropic.Message }> {
  const message = await client.messages.create({
    model: req.model,
    max_tokens: req.max_tokens,
    system: [{ type: "text", text: req.system }],
    messages: req.messages,
    ...callSettings(req.model, req.thinking ?? "off", {
      type: "json_schema",
      schema: forStructuredOutput(req.schema) as Record<string, unknown>,
    }),
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { data, message };
}
