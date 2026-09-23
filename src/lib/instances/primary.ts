import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "./current";

// Is THIS deployment the one place agents are authored?
//
// ---- WHY THE DATABASE ANSWERS AND NOT THE ENVIRONMENT ----------
//
// The boundary that matters is RLS, and RLS can only read what is in
// the database. If the app decided this from an env var and the
// policies decided it from a table, there would be two answers and a
// day when they disagreed. There is one answer, in
// public.instance_settings, and this reads the same row the policies
// read.
//
// ---- WHAT IT IS FOR --------------------------------------------
//
// Not enforcement. Migration 0231 enforces it; a false here only
// stops the Hub from offering controls whose action the database
// would refuse, and lets the page say why. Every mutating action
// checks it too, because a hidden button is a hint and a server-side
// check is a control.
//
// ---- FAILS CLOSED ----------------------------------------------
//
// An unreachable row, a missing table on an instance behind on
// migrations, a thrown client: all false. Read-only is the safe
// answer to "I do not know", and it matches the column default.

export const PRIMARY_INSTANCE_MESSAGE =
  "Agents are managed centrally and cannot be changed on this instance.";

export const isPrimaryInstance = cache(async (): Promise<boolean> => {
  try {
    const db = await createSupabaseServerClient(getCurrentInstanceConfig());
    const { data, error } = await db
      .from("instance_settings")
      .select("is_primary")
      .maybeSingle<{ is_primary: boolean }>();
    if (error) return false;
    return data?.is_primary === true;
  } catch {
    return false;
  }
});

// The guard every mutating Agent Hub action calls, right after its
// role check. Returns null when the write may proceed.
//
// The closure test in authoring-guard.test.ts keeps the list of
// callers complete, because "every action remembers to call this" is
// the kind of convention the twentieth action forgets.
export async function refuseIfNotAuthoringInstance(): Promise<
  { ok: false; message: string } | null
> {
  if (await isPrimaryInstance()) return null;
  return { ok: false, message: PRIMARY_INSTANCE_MESSAGE };
}
