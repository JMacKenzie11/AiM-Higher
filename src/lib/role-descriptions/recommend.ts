import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { formatContextForPrompt, loadFunctionContext } from "./context";

// Direct one-shot recommendation service for the Role Description
// interview. Mirrors the shape of src/lib/measures/critique.ts —
// single Anthropic call, structured JSON parse, no streaming, no
// tool use. Each Suggest button click in the drawer fires exactly
// one of these calls.
//
// Deliberately not routed through /api/coach: the interview is a
// sequence of independent asks, not a chat. Aimee's streaming +
// tool infrastructure would be overhead here.
//
// Flag-not-block: any failure returns an empty list. The drawer
// still lets the user type an answer directly.

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 900;

export type RdTarget =
  | "responsibilities"
  | "outcomes"
  | "measures"
  | "decision_rights"
  | "competencies";

export type Recommendation = {
  title: string;
  body: string | null;
  rationale: string | null;
};

let cachedSystemPrompt: string | null = null;
async function loadSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const file = path.join(process.cwd(), "prompts", "rd-recommendations.md");
  cachedSystemPrompt = await fs.readFile(file, "utf8");
  return cachedSystemPrompt;
}

export async function recommendForFunction(input: {
  functionId: string;
  target: RdTarget;
  // Required when target === "measures" — which outcome the measures
  // should serve. Callers pass the outcome directly rather than
  // making the service re-fetch.
  outcomeTitle?: string;
  outcomeDescription?: string | null;
}): Promise<Recommendation[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const ctx = await loadFunctionContext(input.functionId);
  if (!ctx) return [];

  const systemPrompt = await loadSystemPrompt();
  const userMessage = formatContextForPrompt({
    target: input.target,
    company: ctx.company,
    fn: ctx.fn,
    outcomeTitle: input.outcomeTitle,
    outcomeDescription: input.outcomeDescription ?? null,
  });

  const model =
    process.env.ANTHROPIC_RD_MODEL ||
    process.env.ANTHROPIC_CLARITY_MODEL ||
    DEFAULT_MODEL;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: systemPrompt }],
      messages: [{ role: "user", content: userMessage }],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseRecommendations(raw);
  } catch (err) {
    console.warn("recommendForFunction failed:", err);
    return [];
  }
}

function parseRecommendations(raw: string): Recommendation[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const items = (parsed as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(items)) return [];

  const out: Recommendation[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const title =
      typeof obj.title === "string" ? obj.title.trim().slice(0, 240) : "";
    if (!title) continue;
    const body =
      typeof obj.body === "string" && obj.body.trim().length > 0
        ? obj.body.trim().slice(0, 600)
        : null;
    const rationale =
      typeof obj.rationale === "string" && obj.rationale.trim().length > 0
        ? obj.rationale.trim().slice(0, 240)
        : null;
    out.push({ title, body, rationale });
  }
  return out.slice(0, 5);
}
