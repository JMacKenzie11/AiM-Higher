import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CoachingConversation } from "@/lib/coach/service";
import type { RuleBreakSurface } from "@/lib/aimee/rule-breaks";
import { checkVoice, SENT_BACK, type CheckContext, type CheckedTurn, type VoiceCheck } from "@/lib/aimee/voice-check";
import { skippedStrength } from "@/lib/coach/strength-check";

// HELD-BACK TURNS: the opener, every debrief reply, and the first reply
// in plain Aimee are checked before the person sees them and sent back
// once when they break a rule (route.ts runs the flow).

export const SURFACE: Record<CheckedTurn, RuleBreakSurface> = {
  opener: "opener",
  "debrief reply": "debrief_reply",
  "first reply": "first_reply",
};

// One attempt at a held-back turn, checked against what that turn is
// sent back for, with the context it was checked in.
export type CheckedAttempt = VoiceCheck & { ctx: CheckContext };

// The check for one kind of held-back turn: the same rules module for
// all three, so the route runs one flow. A debrief reply's quotes are
// checked against what was said: the meeting transcript, read once here
// under the caller's own session (same-company members can read the
// meeting row, 0142) and never shown to the model.
export async function turnCheckFor(
  kind: CheckedTurn,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  convo: CoachingConversation,
  firstReply: { client: Anthropic; userText: string; logUsage: (usage: Anthropic.Usage) => void }
): Promise<(text: string) => Promise<CheckedAttempt>> {
  const userText = firstReply.userText;
  if (kind === "first reply") {
    // The strength check is a model call (strength-check.ts), so it
    // runs only when the person's message has a turn in it, and fails
    // open after 2.5 seconds.
    return async (text) => {
      const ctx: CheckContext = {
        userText,
        skippedStrength: await skippedStrength(firstReply.client, userText, text, firstReply.logUsage),
      };
      return { ...checkVoice(text, SENT_BACK[kind], ctx), ctx };
    };
  }
  if (kind === "opener") {
    return async (text) => ({ ...checkVoice(text, SENT_BACK[kind], { userText }), ctx: { userText } });
  }
  const { data: meeting } = convo.debriefing_meeting_id
    ? await supabase
        .from("meetings")
        .select("transcript_text")
        .eq("id", convo.debriefing_meeting_id)
        .maybeSingle<{ transcript_text: string | null }>()
    : { data: null };
  const ctx: CheckContext = { userText, transcript: meeting?.transcript_text ?? "" };
  return async (text) => ({ ...checkVoice(text, SENT_BACK[kind], ctx), ctx });
}
