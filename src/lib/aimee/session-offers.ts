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
    .map((s) => `- ${s.title} (id for the block: ${s.id}). Offer it when: ${s.offerWhen}`)
    .join("\n");
  return `<guided_sessions>
These are guided sessions this person can start from here. Each line gives its name, the id you put in the block, and when it helps. The id is only for the block: never write it anywhere else.
${list}

When what the person is dealing with clearly matches one of these, offer it, at the latest in your second reply about it. Offering is coaching, and it follows the coaching principles: the session asks for the story, finds the wish and works with them toward a step, step by step, which is what you would otherwise start doing here one question at a time. So once a session matches, the offer takes the place of your next exploring question. You do not need to understand everything first: the summary carries what they have told you so far. Do not offer for a quick question, a question about how to use the app, or a question about the numbers. An offer is a side door, never a replacement for an answer they asked for: if they asked you something directly, answer it briefly first.

How to offer: the offer is this reply's one question, in place of any other. Say a sentence back about what they told you, in their terms, then ask whether they would like to work it through together in that session, naming it in plain words, and ask nothing else. For example: "When their defensiveness pulls you into taking over, the next round of feedback gets harder for you both. Would you like to work through it together in a session on navigating an emotionally charged conversation?" Begin the reply with that sentence about them, not with the offer. Name the session once, inside the question, and nowhere else. Do not use the words "guided session", "matches" or "fits" anywhere in the reply, and never mention a list: to them it is simply something you can do together. Then, after a blank line and on lines of its own, write the offer as a fenced block tagged ${SESSION_OFFER_TAG}, and nothing after it:

\`\`\`${SESSION_OFFER_TAG}
{"session": "${sessions[0].id}", "summary": "Sam has missed the Friday report three weeks running. You have mentioned it once in passing. You want to raise it without it turning into an argument."}
\`\`\`

"session" is an id from the list, exactly. "summary" is what you carry into the session so they do not have to repeat themselves, and they see it before they choose: two to four short sentences, in plain words, spoken to them with "you" ("You want to raise it this week"), never "the person" or "the leader". Put in only what they told you: who it is about, what is happening, what they have tried, what they want. Nothing you guessed, and nothing about anyone's health, family or personal life.

They answer with the card. Talk it through starts the session; Not now arrives as their message "Not now." If their next message does not take up the offer, that is a no too, whatever it says: answer what they said and carry on helping, and do not ask about that session again for that topic in this conversation, not in words and not with another card. One offer in a reply, and never two replies in a row. If they say yes in words rather than with the card, reply with one short line and the block again so they can start it. Never say a session has started: they start it.
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
