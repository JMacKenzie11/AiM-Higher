"use server";

import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getCompanyBasics } from "@/lib/companies/basics";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { thisFriday } from "@/lib/dates";

// THE NUMBER ON COMMITMENTS in the Scoreboard sidebar (Jason,
// 2026-11-20): the company's commitments that need attention, by the
// same rule as the Commitments page's Needs attention group
// (isNeedsAttention: open, from a week before this one; parked and
// deleted never count). Read as the person.
//
// Asked for by the sidebar only while it wears the Scoreboard design,
// so no other page pays for the read. Null when there is no company or
// the read fails: the badge simply does not show.
export async function needsAttentionCountAction(): Promise<number | null> {
  try {
    const session = await requireProfile();
    const companyId = await getEffectiveCompanyId(session);
    if (!companyId) return null;
    const company = await getCompanyBasics(companyId);
    const friday = thisFriday(company?.timezone ?? "America/Anchorage");
    const db = await createSupabaseServerClient(getCurrentInstanceConfig());
    const { count, error } = await db
      .from("commitments")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "open")
      .lt("week_ending", friday)
      .is("deleted_at", null)
      .is("parked_at", null);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}
