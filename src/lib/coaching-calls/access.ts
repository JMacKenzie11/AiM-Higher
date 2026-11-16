import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// WHO MAY SEE A COMPANY'S COACHING CALLS (0326).
//
// The company's assigned coaches (an aims_guide or system_admin with a
// guide_assignments row for it) and its current AiMS Champion. Nobody
// else: not a portfolio admin, not an unassigned system admin, not the
// company's admins.
//
// Asked of the database, not worked out here, so the page and the read
// rule cannot disagree: can_read_coaching_call() is the function the
// restrictive policy on meetings calls. Through the caller's own client,
// so auth.uid() is the person asking. Any error reads as no: a page that
// fails closed shows the company's ordinary Meeting Summaries.
export async function canReadCoachingCalls(companyId: string): Promise<boolean> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await db.rpc("can_read_coaching_call", {
    p_company_id: companyId,
  });
  if (error) {
    console.warn("[coaching-calls] access check failed:", error.message);
    return false;
  }
  return data === true;
}

// Whether the caller is one of the company's assigned coaches (not the
// champion). Asked of is_assigned_coach(), the function the source
// trigger uses, for the same reason.
export async function isAssignedCoach(companyId: string): Promise<boolean> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await db.rpc("is_assigned_coach", {
    p_company_id: companyId,
  });
  if (error) {
    console.warn("[coaching-calls] coach check failed:", error.message);
    return false;
  }
  return data === true;
}

// The names said on the tab and the call page ("Only Jason (coach) and
// Sam Patel (AiMS Champion) can see this call."). Read with the service
// role AFTER the caller has passed canReadCoachingCalls: a champion who
// is a team member cannot read guide_assignments, and the line must
// name the coach to them all the same.
export async function coachingCallReaders(
  companyId: string
): Promise<{ coaches: string[]; champion: string | null }> {
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const [{ data: assignments }, { data: company }] = await Promise.all([
    admin
      .from("guide_assignments")
      .select("guide_id, profiles!inner(full_name, role, status)")
      .eq("company_id", companyId),
    admin
      .from("companies")
      .select("aims_champion_profile_id")
      .eq("id", companyId)
      .maybeSingle<{ aims_champion_profile_id: string | null }>(),
  ]);
  type Row = {
    guide_id: string;
    profiles:
      | { full_name: string | null; role: string; status: string }
      | Array<{ full_name: string | null; role: string; status: string }>;
  };
  const coaches = ((assignments ?? []) as unknown as Row[])
    .map((r) => (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles))
    .filter((p) => p && (p.role === "aims_guide" || p.role === "system_admin") && p.status === "active")
    .map((p) => (p.full_name ?? "").trim())
    .filter((n) => n !== "")
    .sort((a, b) => a.localeCompare(b));
  let champion: string | null = null;
  if (company?.aims_champion_profile_id) {
    const { data: p } = await admin
      .from("profiles")
      .select("full_name, status")
      .eq("id", company.aims_champion_profile_id)
      .maybeSingle<{ full_name: string | null; status: string }>();
    champion = p?.status === "active" ? (p.full_name?.trim() || null) : null;
  }
  return { coaches, champion };
}
