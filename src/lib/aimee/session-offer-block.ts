// AIMEE'S OFFER OF A GUIDED SESSION, the block (Jason, 2026-10-05).
//
// In an open conversation Aimee may offer one of the guided sessions
// (agents) the person can start. The offer is a sentence asking, and
// then this block, which the chat shows as a card: the session, the
// summary Aimee will carry into it, Talk it through and Not now.
//
// No imports: the card (a client component) parses with it, and so
// does the server action that starts the session, which reads the
// block from the SAVED message rather than trusting anything the
// browser sends.

export const SESSION_OFFER_TAG = "session_offer";

// The handoff_summary constraint (0262).
export const HANDOFF_SUMMARY_MAX = 1500;

export type SessionOffer = {
  // The agent's id (its slug), as the list in the prompt gave it.
  session: string;
  // What Aimee carries into the session, shown on the card.
  summary: string;
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

// Null while the block is still arriving, or if what arrived is not
// an offer: the card says nothing rather than showing braces.
export function parseSessionOffer(raw: string): SessionOffer | null {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as { session?: unknown; summary?: unknown };
  if (typeof v.session !== "string" || !SLUG.test(v.session.trim())) return null;
  if (typeof v.summary !== "string") return null;
  const summary = v.summary.trim().slice(0, HANDOFF_SUMMARY_MAX);
  if (!summary) return null;
  return { session: v.session.trim(), summary };
}

// The offer in a whole saved message, for the server. The LAST block
// wins, the same one the person saw last if Aimee ever wrote two.
export function findSessionOffer(content: string): SessionOffer | null {
  const fence = new RegExp("```" + SESSION_OFFER_TAG + "\\s*\\n([\\s\\S]*?)```", "g");
  let found: SessionOffer | null = null;
  for (const m of content.matchAll(fence)) {
    const parsed = parseSessionOffer(m[1]);
    if (parsed) found = parsed;
  }
  return found;
}
