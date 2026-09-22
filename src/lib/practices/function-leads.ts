import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Does this person head up a function?
//
// Its own module so both the picker and the gate can ask without
// either importing the other, and so the question has one answer.
//
// Runs on the caller's own client. RLS on `functions` already scopes
// the read to their company, so this cannot report a lead role in a
// company they cannot see.

export async function leadsAnyFunction(
  profileId: string,
  companyId: string
): Promise<boolean> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await db
    .from("functions")
    .select("id")
    .eq("company_id", companyId)
    .eq("lead_id", profileId)
    .eq("archived", false)
    .limit(1);
  return (data ?? []).length > 0;
}

// Whether this person leads THIS function. The save path asks it,
// because holding a seat admits you to that seat's document and not
// to every seat's.
export async function leadsFunction(
  profileId: string,
  functionId: string
): Promise<boolean> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await db
    .from("functions")
    .select("id")
    .eq("id", functionId)
    .eq("lead_id", profileId)
    .eq("archived", false)
    .limit(1);
  return (data ?? []).length > 0;
}

// Every function this person leads in a company, as a set of ids.
// The /people card asks it once and answers per row, rather than one
// round trip per saved role description.
export async function functionsLedBy(
  profileId: string,
  companyId: string
): Promise<Set<string>> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await db
    .from("functions")
    .select("id")
    .eq("company_id", companyId)
    .eq("lead_id", profileId)
    .eq("archived", false);
  return new Set(((data ?? []) as Array<{ id: string }>).map((f) => f.id));
}
