import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Read model for the AiMS Guides card on /admin/companies. Aggregates
// each guide with the companies they're assigned to so the sysadmin
// can see the whole coaching graph in one view.

export type GuideOverviewRow = Pick<
  Profile,
  "id" | "full_name" | "status" | "invited_at"
> & {
  email: string | null;
  assignments: Array<{ company_id: string; company_name: string }>;
};

export async function getGuidesOverview(): Promise<GuideOverviewRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data: guideRows } = await supabase
    .from("profiles")
    .select("id, full_name, status, invited_at")
    .eq("role", "aims_guide")
    .order("full_name");
  const guides = (guideRows ?? []) as Array<
    Pick<Profile, "id" | "full_name" | "status" | "invited_at">
  >;
  if (guides.length === 0) return [];

  const guideIds = guides.map((g) => g.id);
  const { data: assignmentRows } = await supabase
    .from("guide_assignments")
    .select("guide_id, company_id, companies!inner(name)")
    .in("guide_id", guideIds);

  type AssignmentJoin = {
    guide_id: string;
    company_id: string;
    companies: { name: string } | { name: string }[] | null;
  };
  const assignmentsByGuide = new Map<
    string,
    Array<{ company_id: string; company_name: string }>
  >();
  for (const row of (assignmentRows ?? []) as AssignmentJoin[]) {
    const companyName = Array.isArray(row.companies)
      ? row.companies[0]?.name ?? "(unnamed)"
      : row.companies?.name ?? "(unnamed)";
    const list = assignmentsByGuide.get(row.guide_id) ?? [];
    list.push({ company_id: row.company_id, company_name: companyName });
    assignmentsByGuide.set(row.guide_id, list);
  }

  // Emails come from auth.users — a separate admin-role query is
  // needed because RLS on auth schema blocks the postgres role we
  // run as here. For now, skip the email hydration and rely on the
  // guide's full_name for display.
  return guides.map((g) => ({
    id: g.id,
    full_name: g.full_name,
    status: g.status,
    invited_at: g.invited_at,
    email: null,
    assignments: assignmentsByGuide.get(g.id) ?? [],
  }));
}
