import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { usageLogger } from "@/lib/coach/usage";
import { requestJson } from "@/lib/transcripts/model";
import { VOICE_CORE } from "@/lib/voice/core";
import { PERSONAL_DETAIL_RULE } from "@/lib/voice/personal-detail";
import { checkTurn, conversationInput, CONVERSATION_SCHEMA, type Exchange, type Turn } from "./conversation";

// THE CONVERSATION HELPER'S CALL (diagnostic_conversation). One turn:
// given the question being asked and what the person has said, one
// follow-up for the lead or a sign to move on, and the two short notes
// fields. Haiku 5.5 for speed, since the lead is in the room waiting,
// thinking off, structured output, checked by checkTurn.

const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 1000;

const SYSTEM = `You sit beside the person running a confidential 30-minute conversation with one team member during a Capacity Diagnostic. The conversation walks five fixed questions about the person's best work, what gets in the way of it, and where they would put a few hours back each week. The person running it types what the team member said; you help them get one clear, specific answer to each question.

For the question being asked, decide whether what they have said answers it with something specific: a real example, a named task, a concrete wish. If it does, set move_on to true and leave follow_up empty. If it is vague or general, write one short follow-up question the person running it can ask next.

A good follow-up:
- asks for one specific example, moment or task, drawing on what the person did well and what they want more of;
- uses the team member's own words back to them where it can;
- is one sentence, spoken plainly, under 25 words, ending with a question mark;
- never suggests an answer, never asks about other people's performance, and never asks about pay or job security.

Also write peak_experience (their best work, from question 1) and redeploy_wish (where the hours would go, from question 5), each one line in the team member's own words where possible, and empty until they have said it.

${PERSONAL_DETAIL_RULE} Never ask about health, family or life outside work, even when they raise it.

${VOICE_CORE}`;

export type TurnResult = { ok: true; turn: Turn } | { ok: false; message: string };

export async function conversationTurn(question: number, exchanges: readonly Exchange[], role: string | null): Promise<TurnResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, message: "The conversation helper isn't set up on this server." };
  const model = process.env.ANTHROPIC_DIAGNOSTIC_CONVERSATION_MODEL || DEFAULT_MODEL;
  try {
    const { data, message } = await requestJson(new Anthropic({ apiKey }), {
      model,
      max_tokens: MAX_TOKENS,
      thinking: "off",
      system: SYSTEM,
      schema: CONVERSATION_SCHEMA,
      messages: [{ role: "user", content: conversationInput(question, exchanges, role) }],
    });
    usageLogger({ companyId: null, purpose: "diagnostic_conversation", model })(message);
    return { ok: true, turn: checkTurn(data) };
  } catch (err) {
    console.warn("[diagnostics] conversation turn failed:", err);
    return { ok: false, message: "The helper didn't answer. Their words are saved; carry on with the guide." };
  }
}
