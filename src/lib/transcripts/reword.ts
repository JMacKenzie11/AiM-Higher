import type Anthropic from "@anthropic-ai/sdk";
import { PERSONAL_DETAIL_RULE } from "@/lib/voice/personal-detail";
import { stripEmDashes } from "@/lib/voice/strip-dashes";
import { callSettings } from "./model";

// REWORDING A LINE WITHOUT THE PERSONAL DETAIL.
//
// A commitment or an issue is never dropped for mentioning somebody's
// private life (Jason, 2026-10-01: "A commitment must never be lost").
// It is reworded instead: one call for every flagged line, each kept
// to what is to be done, by whom and by when. A sentence of the
// summary or review goes the same way, and only that sentence: the
// summary is never regenerated to fix one line (a full rewrite of a
// long Benson summary came back as a 328-character fragment).
// Whether the rewrite is clean is the caller's check (redact.ts), not
// the model's word; an item still breaking the rule is kept as it was
// and flagged for the company admin to reword.
//
// Used by the pipeline at the write and by the proposals script for
// rows stored before the rule, so both reword the same way.

export type Reword = (texts: readonly string[]) => Promise<Array<string | null>>;

const SYSTEM = `Each item below is one line from the record of a meeting's work: a sentence of its summary or review, a commitment, an issue, or the reason a commitment was noted. Each one mentions somebody's private life, which the record must never do.

Reword each item so it keeps what is to be done, who does it, and any date it already gives, and leaves the personal detail out entirely. Never add anything the item does not say. Keep it about the same length.

${PERSONAL_DETAIL_RULE}

Example: "Lee covers Sam's accounts through December while Sam is on medical leave" becomes "Lee covers Sam's accounts through December".

Reply with a JSON array of strings only: one per item, in the same order.`;

function parse(text: string, expected: number): Array<string | null> {
  const nulls = Array.from({ length: expected }, () => null);
  const json = /\[[\s\S]*\]/.exec(text)?.[0];
  if (!json) return nulls;
  try {
    const arr: unknown = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length !== expected) return nulls;
    return arr.map((v) => (typeof v === "string" && v.trim() ? stripEmDashes(v.trim()) : null));
  } catch {
    return nulls;
  }
}

// Best effort: a call that fails or answers in the wrong shape returns
// nulls, and every item is kept as it was, flagged. Never thrown, so a
// rewording problem can never fail the meeting.
export function rewordWithModel(
  client: Anthropic,
  model: string,
  onMessage?: (message: Anthropic.Message) => void
): Reword {
  return async (texts) => {
    if (texts.length === 0) return [];
    try {
      const message = await client.messages.create({
        model,
        ...callSettings(model, "off"),
        max_tokens: 2000,
        system: [{ type: "text", text: SYSTEM }],
        messages: [{ role: "user", content: JSON.stringify(texts) }],
      });
      onMessage?.(message);
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return parse(text, texts.length);
    } catch (err) {
      console.error("[analyze] rewording failed:", err instanceof Error ? err.message : err);
      return texts.map(() => null);
    }
  };
}

// Exported for the pipeline test, which tells the calls apart by it.
export const REWORD_SYSTEM_FOR_TEST = SYSTEM;
