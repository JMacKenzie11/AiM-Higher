import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GateProfile } from "@/lib/practices/gate";
import { logCoachTokenUsage } from "@/lib/coach/usage";
import { offerableSessions, type OfferableSession } from "./session-offers";

// WHICH AGENT A HANDED-OVER TOPIC OPENS (0281).
//
// Not a second routing system. It is the list Aimee offers sessions from
// in conversation (offerableSessions): every Agent Hub agent with an
// "Offer this when" line that this person could start in this company,
// read under their own session, so a new agent given a line in the Hub
// is reachable here the day it is published. The only difference is the
// question: Aimee decides mid-conversation; here there is one topic, so
// the model is asked once which session, if any, fits it. No fit, or
// any failure, opens plain Aimee with the topic.

const DEFAULT_MODEL = "claude-sonnet-5";

export function routingPrompt(sessions: readonly OfferableSession[]): string {
  const list = sessions.map((s) => `- ${s.id}: ${s.title}. Fits when: ${s.offerWhen}`).join("\n");
  return `You route a short topic to one guided session in a coaching app, or to none.

Sessions:
${list}

Reply with exactly one line: the id of the one session that clearly fits the topic, or the word none. Choose a session only when the topic plainly matches its "Fits when" line. Nothing else in the reply.`;
}

export function parseRoutedId(raw: string, sessions: readonly OfferableSession[]): string | null {
  const word = raw.trim().split(/\s+/)[0]?.replace(/[`"'.,]/g, "") ?? "";
  return sessions.some((s) => s.id === word) ? word : null;
}

export async function chooseAgentForTopic(args: {
  db: SupabaseClient;
  profile: GateProfile;
  companyId: string;
  topic: string;
}): Promise<string | null> {
  const sessions = await offerableSessions({ db: args.db, profile: args.profile, companyId: args.companyId });
  if (sessions.length === 0) return null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.ANTHROPIC_ROUTING_MODEL || DEFAULT_MODEL;
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model,
      max_tokens: 40,
      system: [{ type: "text", text: routingPrompt(sessions) }],
      messages: [{ role: "user", content: `Topic: ${args.topic.trim()}` }],
    });
    if (res.usage) {
      void logCoachTokenUsage({ conversationId: null, companyId: args.companyId, purpose: "other", model, usage: res.usage });
    }
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseRoutedId(raw, sessions);
  } catch (err) {
    console.warn("chooseAgentForTopic failed:", err);
    return null;
  }
}
