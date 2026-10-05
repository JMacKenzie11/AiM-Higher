import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { listAgents } from "@/lib/practices/resolve";
import { practiceGate, type GateProfile } from "@/lib/practices/gate";
import { loadOfferWhen } from "@/lib/practices/offer-when";
import { SESSION_OFFER_TAG } from "./session-offer-block";

// AIMEE OFFERS A GUIDED SESSION (Jason, 2026-10-05), the server half.
//
// Which sessions Aimee may offer, and what Aimee is told about offering
// them. Plain Aimee only (an open conversation on the Aimee page or in
// the panel, no agent running), and only to the conversation's owner:
// the route decides that, this decides the list.
//
// A session is on the list when it has an "Offer this when" sentence
// (agents.offer_when, 0262) AND this person could start it here: the
// same practiceGate the launch path runs, so Aimee never offers what
// the button would then refuse. A new agent joins by being given a
// sentence in the Hub; nothing here names one.

export type OfferableSession = { id: string; title: string; offerWhen: string };

export async function offerableSessions(args: {
  db: SupabaseClient;
  profile: GateProfile;
  companyId: string;
}): Promise<OfferableSession[]> {
  const agents = (await listAgents()).filter((a) => a.agentRowId && !a.archived);
  if (agents.length === 0) return [];
  const lines = await loadOfferWhen(
    args.db,
    agents.map((a) => a.agentRowId as string)
  );
  const out: OfferableSession[] = [];
  for (const agent of agents) {
    const offerWhen = lines.get(agent.agentRowId as string);
    if (!offerWhen) continue;
    const gate = await practiceGate(agent, args.profile, args.companyId);
    if (!gate.ok) continue;
    out.push({ id: agent.id, title: agent.title, offerWhen });
  }
  return out;
}

// In the system prompt of an open conversation, when the list is not
// empty. The principles (prompts/aims-coaching-principles.md) still
// lead: coaching first, and an offer is a side door.
export function sessionOfferPromptBlock(sessions: readonly OfferableSession[]): string {
  if (sessions.length === 0) return "";
  const list = sessions
    .map((s) => `- ${s.id}: ${s.title}. Offer it when: ${s.offerWhen}`)
    .join("\n");
  return `<guided_sessions>
These are guided sessions this person can start from here. Each line gives its id, its name, and when it helps.
${list}

When what the person is dealing with clearly matches one of these, and they are getting ready to do that thing, offer it. Not for a quick question, and not before you understand what is going on: ask first if you need to. Help them in this conversation first. An offer is a side door, never a replacement for an answer they asked for.

How to offer: in a reply that also helps, end with one short question asking whether they would like to work it through in that session, naming it in plain words. Then write the offer as a fenced block tagged ${SESSION_OFFER_TAG}, and nothing after it:

\`\`\`${SESSION_OFFER_TAG}
{"session": "${sessions[0].id}", "summary": "Sam has missed the Friday report three weeks running. You have mentioned it once in passing. You want to raise it without it turning into an argument."}
\`\`\`

"session" is an id from the list, exactly. "summary" is what you carry into the session so they do not have to repeat themselves, and they see it before they choose: two to four short sentences, in plain words, spoken to them with "you" ("You want to raise it this week"), never "the person" or "the leader". Put in only what they told you: who it is about, what is happening, what they have tried, what they want. Nothing you guessed, and nothing about anyone's health, family or personal life.

They answer with the card. Talk it through starts the session; Not now arrives as their message "Not now." When they decline, or move on to something else, carry on helping and do not offer that session again for that topic in this conversation. One offer in a reply, and never two replies in a row. If they say yes in words rather than with the card, reply with one short line and the block again so they can start it. Never say a session has started: they start it.
</guided_sessions>`;
}

// On every turn of a session started from an offer.
export function handoffBlock(summary: string): string {
  return `<handoff>
This session was started from a conversation with Aimee. Before starting it, the person saw and accepted this summary of what they had said:

${summary}

Work from it. Do not ask them to repeat what it already says; ask only for what it leaves out. Speak of it as what they told you, never as a handoff or a summary: those words are for you, not for them.
</handoff>`;
}

// The synthetic first turn for a session started from an offer, in
// place of the route's usual "introduce yourself" one: the person has
// been talking to Aimee already, and the summary is on screen above.
export const HANDOFF_OPENER_PROMPT =
  "Open this session. The person has just come from a conversation with Aimee, and <handoff> holds what they said. In one or two sentences show you have it, without repeating it word for word and without calling it a handoff or a summary. Then begin the guided flow you are designed for from where that leaves you: skip any step the summary already answers, and ask about the first thing it leaves out. Do not introduce yourself. Keep the opener under 100 words.";
