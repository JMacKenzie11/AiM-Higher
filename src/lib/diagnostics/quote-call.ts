import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { usageLogger } from "@/lib/coach/usage";
import { requestJson } from "@/lib/transcripts/model";
import { PERSONAL_DETAIL_RULE } from "@/lib/voice/personal-detail";
import { MAX_SUGGESTED, MIN_SUGGESTED, QUOTE_SCHEMA, validateQuoteLines } from "./quote-lines";

// THE QUOTE CALL (diagnostic_quotes). Reads one conversation's notes and
// proposes lines the readout could use, in the person's own words.
// Sonnet 5, thinking off, structured output. Every line is checked
// against the notes (quote-lines.ts) and lands as an unapproved quote
// with no name; nothing reaches the owner until the lead approves it.

// Sonnet 5, as the brief names it and the dashboard brief uses: Sonnet 5.5
// refuses thinking disabled (probed 2026-10-22), which callSettings sends.
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2000;

const SYSTEM = `You read the notes from one confidential conversation in a Capacity Diagnostic, where a team member talked about their best work, what gets in the way of it, and what they would do with a few hours back each week.

Pick ${MIN_SUGGESTED} to ${MAX_SUGGESTED} lines the owner should hear in the readout: lines about the work itself, what drains the person's time, what they are best at, and where they would put the hours. Copy each line exactly as it appears in the notes, word for word, without changing, joining or shortening it. Pick whole sentences or clear phrases of at least four words.

Leave out anything that would identify the person to the owner, anything critical of a named colleague, and anything private. ${PERSONAL_DETAIL_RULE}

If the notes hold fewer good lines, return fewer.`;

export type QuoteSuggestion = { ok: true; lines: string[] } | { ok: false; message: string };

export async function suggestQuoteLines(notes: string, existing: readonly string[]): Promise<QuoteSuggestion> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, message: "Quote suggestions aren't set up on this server." };
  const model = process.env.ANTHROPIC_DIAGNOSTIC_QUOTES_MODEL || DEFAULT_MODEL;
  try {
    const { data, message } = await requestJson(new Anthropic({ apiKey }), {
      model,
      max_tokens: MAX_TOKENS,
      thinking: "off",
      system: SYSTEM,
      schema: QUOTE_SCHEMA,
      messages: [{ role: "user", content: JSON.stringify({ notes, lines_already_on_the_list: existing }) }],
    });
    usageLogger({ companyId: null, purpose: "diagnostic_quotes", model })(message);
    return { ok: true, lines: validateQuoteLines(data, notes, existing) };
  } catch (err) {
    console.warn("[diagnostics] quote suggestions failed:", err);
    return { ok: false, message: "The suggestions didn't come back. Try again." };
  }
}
