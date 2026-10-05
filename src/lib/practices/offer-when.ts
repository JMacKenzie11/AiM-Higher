import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { OFFER_WHEN_MAX } from "./offer-when-limits";

// When Aimee should offer a guided session (agents.offer_when, 0262).
//
// ---- WHY ITS OWN QUERY ----------------------------------------
//
// Every picker and launch path reads agents through one query in
// resolve.ts, and when that query fails they all fall back to the
// code registry, which has no database-defined agents in it. Adding
// offer_when to that select would mean code deployed ahead of the
// migration, on any instance, silently drops every Hub-built agent
// from every picker there. So the column is read here, alone, and a
// failure means "no sentences", which costs Aimee the offers and
// nothing else.
//
// ---- LIMITS ---------------------------------------------------
//
// The column's check constraint holds 300 characters; the Hub's
// action holds the same, so a too-long line is refused in words
// before the database refuses it in an error.

export { OFFER_WHEN_MAX };

// Agent row id -> sentence, for the agents that have one. Empty on
// any error, including the column not existing yet.
export async function loadOfferWhen(
  db: SupabaseClient,
  agentIds?: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    let query = db.from("agents").select("id, offer_when").not("offer_when", "is", null);
    if (agentIds) query = query.in("id", agentIds as string[]);
    const { data, error } = await query;
    if (error) return out;
    for (const row of (data ?? []) as Array<{ id: string; offer_when: string | null }>) {
      const line = row.offer_when?.trim();
      if (line) out.set(row.id, line);
    }
  } catch {
    // Same as an error: no sentences.
  }
  return out;
}

// The Hub's input, trimmed. Empty means "never offer it" (null).
export function normalizeOfferWhen(
  raw: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > OFFER_WHEN_MAX) {
    return { ok: false, message: `Keep "Offer this when" under ${OFFER_WHEN_MAX} characters.` };
  }
  return { ok: true, value };
}

// One agent's sentence for a fleet push (distribution.ts), where "no
// sentence" and "could not read it" must not look alike: the first
// clears the target's, the second leaves it alone. Undefined on any
// error.
export async function readOfferWhen(
  db: SupabaseClient,
  agentId: string
): Promise<string | null | undefined> {
  try {
    const { data, error } = await db
      .from("agents")
      .select("offer_when")
      .eq("id", agentId)
      .maybeSingle<{ offer_when: string | null }>();
    if (error || !data) return undefined;
    return data.offer_when?.trim() || null;
  } catch {
    return undefined;
  }
}
