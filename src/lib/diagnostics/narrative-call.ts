import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { usageLogger } from "@/lib/coach/usage";
import { requestJson } from "@/lib/transcripts/model";
import { VOICE_CORE } from "@/lib/voice/core";
import { findBannedPhrases, retryInstruction } from "@/lib/voice/banned";
import { personalDetailMatcher, removePersonalDetail, PERSONAL_DETAIL_RULE } from "@/lib/voice/personal-detail";
import { READOUT_SECTIONS, type Narrative, type ReadoutSection } from "./types";
import { checkNarrative, findDenials, narrativeInput, NARRATIVE_SCHEMA } from "./narrative";
import type { ReadoutData } from "./readout";

// THE READOUT WRITER (diagnostic_readout). One short paragraph for each
// readout section, from the assembled readout and nothing else. Sonnet
// 5, thinking off, structured output with the evidence before each
// paragraph. A paragraph that states a number the input did not carry
// is dropped (narrative.ts), one that breaks the voice rules (a banned
// phrase, or a "not just X but Y") is asked for again once, and a sentence about somebody's private life is
// taken out.

// Sonnet 5, as the brief names it and the dashboard brief uses: Sonnet 5.5
// refuses thinking disabled (probed 2026-10-22), which callSettings sends.
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 6000;

const SYSTEM = `You write the narrative of a Capacity Diagnostic readout: a one-page report a small business owner reads after a three-week engagement that found the hours their team spends on draining, routine work and gave some of them back.

The readout has these sections, in this order: ${READOUT_SECTIONS.map((s) => s.title).join(", ")}. For each, first list the evidence you are using (the figures and facts from the input, copied exactly), then write one short paragraph of two to four sentences that tells the owner what that section shows and why it matters to them.

Rules for the words:
- Write to the owner, as "you" and "your team".
- Use only the numbers in "figures_you_may_use", written exactly as they appear there. Never round, add, convert or invent a number. If a section needs a number that is not there, write the paragraph without it.
- The recovery rate is the share of the first win's own task hours that the first win gave back, written with a percent sign ("60%"). It is separate from the guarantee, which is a number of hours. Write a date as a reader would say it ("October 16, 2026").
- Measured hours and projected hours are two separate numbers. Never add them together or blur them. The measured figure is what the first win returned in its first full week. The projected figure is a further estimate, on top of the measured one, for the other candidate tasks at the rate the first win achieved; write it as "a further" amount, never as what the measured hours "grow to".
- The quotes come from one-to-one conversations with the team during the diagnostic, not from the kickoff. The owner's own words at kickoff are in "owner_words_at_kickoff".
- Name nobody. Refer to roles, never to a person, except that an approved quote may carry the name it was given.
- When a section has nothing in the input (no quotes yet, no roadmap yet), write one sentence saying what will go there.
- Plain English, short sentences, no jargon, no sales language, no exclamation marks.
- Never set a thing against what it is not: no "not a guess", "not just X but Y", "not one number added to the other". Say only what it is. Never repeat a point another sentence already made.
- ${PERSONAL_DETAIL_RULE}

${VOICE_CORE}`;

export type NarrativeResult =
  | { ok: true; narrative: Narrative; dropped: ReadoutSection[] }
  | { ok: false; message: string };

export async function writeNarrative(r: ReadoutData, ownerWords: string | null): Promise<NarrativeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, message: "The readout writer isn't set up on this server." };
  const model = process.env.ANTHROPIC_DIAGNOSTIC_READOUT_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });
  const log = usageLogger({ companyId: null, purpose: "diagnostic_readout", model });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: narrativeInput(r, ownerWords) }];

  try {
    let { data, message } = await requestJson(client, { model, max_tokens: MAX_TOKENS, thinking: "off", system: SYSTEM, schema: NARRATIVE_SCHEMA, messages });
    log(message);
    let checked = checkNarrative(data, r);
    const written = Object.values(checked.narrative).join("\n");
    const hits = [...findBannedPhrases(written), ...findDenials(written)];
    if (hits.length > 0) {
      ({ data, message } = await requestJson(client, {
        model,
        max_tokens: MAX_TOKENS,
        thinking: "off",
        system: SYSTEM,
        schema: NARRATIVE_SCHEMA,
        messages: [...messages, { role: "assistant", content: JSON.stringify(data) }, { role: "user", content: retryInstruction(hits) }],
      }));
      log(message);
      checked = checkNarrative(data, r);
    }
    // A sentence about somebody's private life comes out, whatever else.
    const match = personalDetailMatcher({ mode: "moment" });
    const narrative: Narrative = {};
    for (const [k, v] of Object.entries(checked.narrative) as Array<[ReadoutSection, string]>) {
      const clean = removePersonalDetail(v, match).text.trim();
      if (clean) narrative[k] = clean;
    }
    if (Object.keys(narrative).length === 0) return { ok: false, message: "The readout writer came back empty. Try again." };
    if (checked.dropped.length) console.warn("[diagnostics] readout narrative: numbers outside the readout", checked.foreign);
    return { ok: true, narrative, dropped: checked.dropped };
  } catch (err) {
    console.warn("[diagnostics] readout narrative failed:", err);
    return { ok: false, message: "The readout writer didn't answer. Try again." };
  }
}
