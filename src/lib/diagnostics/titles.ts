import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usageLogger } from "@/lib/coach/usage";
import { requestJson } from "@/lib/transcripts/model";
import { stripEmDashes } from "@/lib/voice/strip-dashes";

// THE CANONICAL-TITLE CALL. Reads every task title in one diagnostic
// and gives each a shared name, so "quotes", "quoting" and "writing up
// quotes" roll up into one row on the candidate list and one cluster
// on the Capacity Map. Mirrors commitments/clarity.ts: Haiku 5.5,
// thinking off, structured output, logged as diagnostic_titles. The
// model only names; every figure stays in hours-back.ts.
//
// Fills only tasks with no canonical title yet, so a name the lead
// typed is never overwritten; those names go in as the ones to reuse.
// A failed call leaves canonical_title null and the grid falls back to
// the typed title.

const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 4000;

const SYSTEM = `You group the recurring tasks people in one small business reported, so the same work done by different people shares one name.

For each task, return a short canonical name (two to five words, plain English, sentence case) for the work it describes. Tasks that are the same work get exactly the same name. Tasks that are different work get different names. When a name in "names already in use" fits, reuse it exactly.

Never use dashes. Return every task id you were given, once.`;

const SCHEMA = {
  type: "object",
  properties: {
    titles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          canonical_title: { type: "string" },
        },
        required: ["id", "canonical_title"],
      },
    },
  },
  required: ["titles"],
};

export function validateTitles(data: unknown, ids: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const allowed = new Set(ids);
  const list = (data as { titles?: unknown } | null)?.titles;
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const id = (item as { id?: unknown })?.id;
    const title = (item as { canonical_title?: unknown })?.canonical_title;
    if (typeof id !== "string" || !allowed.has(id) || out.has(id) || typeof title !== "string") continue;
    const clean = stripEmDashes(title).replace(/\s+/g, " ").trim().slice(0, 120);
    if (clean) out.set(id, clean);
  }
  return out;
}

export async function rollUpTitles(supabase: SupabaseClient, diagnosticId: string): Promise<"done" | "nothing" | "failed"> {
  const { data } = await supabase
    .from("diagnostic_tasks")
    .select("id, title, canonical_title")
    .eq("diagnostic_id", diagnosticId)
    .limit(500);
  const rows = (data ?? []) as Array<{ id: string; title: string; canonical_title: string | null }>;
  const todo = rows.filter((r) => !r.canonical_title);
  if (todo.length === 0) return "nothing";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "failed";
  const model = process.env.ANTHROPIC_DIAGNOSTIC_TITLES_MODEL || DEFAULT_MODEL;
  const inUse = [...new Set(rows.map((r) => r.canonical_title).filter((t): t is string => Boolean(t)))];

  try {
    const { data: out, message } = await requestJson(new Anthropic({ apiKey }), {
      model,
      max_tokens: MAX_TOKENS,
      thinking: "off",
      system: SYSTEM,
      schema: SCHEMA,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            names_already_in_use: inUse,
            tasks: todo.map((r) => ({ id: r.id, title: r.title })),
          }),
        },
      ],
    });
    usageLogger({ companyId: null, purpose: "diagnostic_titles", model })(message);
    const titles = validateTitles(out, todo.map((r) => r.id));
    if (titles.size === 0) return "failed";
    for (const [id, canonical_title] of titles) {
      // Only while still empty, so a name typed meanwhile stands.
      await supabase.from("diagnostic_tasks").update({ canonical_title }).eq("id", id).is("canonical_title", null);
    }
    return "done";
  } catch (err) {
    console.warn("[diagnostics] canonical titles failed:", err);
    return "failed";
  }
}
