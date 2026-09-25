import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// WHO HOLDS THE AiMS CHAMPION SEAT.
//
// One company, one champion, stored as a column on `companies`
// rather than a role, because it is not a permission. It is where
// Aimee sends the week's nudge. A champion is usually already a
// company_admin; often they are a team_member who happens to be the
// person who actually runs the rhythm.
//
// ---- READ THE COLUMN, DO NOT INFER IT --------------------------
//
// There is no membership table to join and no derived shape to keep
// in step: the seat IS the column. Everything that asks reads it
// here, so the answer is one query in one place and a future change
// of storage has one site to edit.
//
// Runs on the caller's own client. RLS on `companies` already scopes
// the read, so this cannot report a seat in a company the caller
// cannot see.

export async function isAimsChampion(
  profileId: string,
  companyId: string
): Promise<boolean> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await db
    .from("companies")
    .select("aims_champion_profile_id")
    .eq("id", companyId)
    .maybeSingle<{ aims_champion_profile_id: string | null }>();
  return data?.aims_champion_profile_id === profileId;
}
