import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";

export type AssignablePerson = Pick<
  Profile,
  "id" | "full_name" | "position"
>;

// Everyone who can be given a commitment in a company.
//
// The company's own active members, plus the people ASSIGNED to work
// with it: AiMS Guides through guide_assignments, and portfolio
// admins through portfolio_assignments. A guide is doing the work
// alongside the team, so a commitment can land on them like it lands
// on anybody else.
//
// NOTHING IN THE DATABASE EVER STOPPED THIS. commitments.owner_id is
// `references profiles(id)` and carries no constraint tying an owner
// to the row's company. The only thing keeping guides out of the
// picker was the picker.
//
// WHAT THIS REPLACES, and why it is a fix rather than an addition.
// getCommitmentsPanel appended `role = 'system_admin'` profiles here
// "so a coach can be selected as owner". Measured on the dev clone as
// a real company_admin, that query returned ZERO rows and always had:
// profiles_select admits a system_admin, a member of the same
// company, or yourself, and a platform role is none of those. The
// feature read as a feature and behaved as an empty list for every
// company user. Reaching people by ASSIGNMENT rather than by ROLE is
// what makes it work, and 0204 is the policy that lets a company see
// them at all.
export async function getAssignablePeople(
  supabase: SupabaseClient,
  companyId: string
): Promise<AssignablePerson[]> {
  const [membersRes, guideRes, portfolioRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, position")
      .eq("company_id", companyId)
      .neq("status", "inactive")
      .order("full_name"),
    supabase
      .from("guide_assignments")
      .select("guide_id")
      .eq("company_id", companyId),
    supabase
      .from("portfolio_assignments")
      .select("portfolio_admin_id")
      .eq("company_id", companyId),
  ]);

  const members = (membersRes.data ?? []) as AssignablePerson[];

  const assignedIds = [
    ...((guideRes.data ?? []) as Array<{ guide_id: string }>).map(
      (r) => r.guide_id
    ),
    ...((portfolioRes.data ?? []) as Array<{ portfolio_admin_id: string }>).map(
      (r) => r.portfolio_admin_id
    ),
  ].filter((id) => !members.some((m) => m.id === id));

  if (assignedIds.length === 0) return members;

  // Read through the caller's own client, so profiles_select_assigned
  // (0204) is what decides. A caller who cannot see these rows gets
  // the members and nothing else, which is the same list they had
  // before this existed.
  const { data: assignedRows } = await supabase
    .from("profiles")
    .select("id, full_name, position")
    .in("id", assignedIds)
    .neq("status", "inactive")
    .order("full_name");

  return [...members, ...((assignedRows ?? []) as AssignablePerson[])];
}
