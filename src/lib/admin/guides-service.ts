import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Read model for the AiMS Guides card on /admin/companies. Aggregates
// each guide with the companies they're assigned to so the sysadmin
// can see the whole coaching graph in one view.
//
// Two roles appear here:
//   - aims_guide: assignment IS the access grant (existing model).
//   - system_admin with at least one guide_assignments row: the
//     assignment is a caseload marker only — sysadmins already have
//     unrestricted cross-tenant access, so unassigning them never
//     reduces access. Included in the panel so the sysadmin can see
//     their own coaching caseload and jump to Guide HQ.

export type GuideOverviewRow = Pick<
  Profile,
  "id" | "full_name" | "status" | "invited_at"
> & {
  role: "aims_guide" | "system_admin";
  email: string | null;
  assignments: Array<{ company_id: string; company_name: string }>;
};

export async function getGuidesOverview(): Promise<GuideOverviewRow[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // aims_guides always appear (their access is defined by assignments,
  // so even a zero-assignment guide is worth showing so a sysadmin
  // can top them up). system_admins appear only when they hold at
  // least one assignment — a sysadmin with no caseload isn't a guide
  // in any meaningful sense.
  const [{ data: guideRows }, { data: sysadminIdsWithAssignments }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, status, invited_at, role")
        .eq("role", "aims_guide")
        .order("full_name"),
      supabase
        .from("guide_assignments")
        .select("guide_id, profiles!inner(role)")
        .eq("profiles.role", "system_admin"),
    ]);

  const sysadminIds = Array.from(
    new Set(
      ((sysadminIdsWithAssignments ?? []) as Array<{ guide_id: string }>).map(
        (r) => r.guide_id
      )
    )
  );

  const { data: sysadminRows } =
    sysadminIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name, status, invited_at, role")
          .in("id", sysadminIds)
          .order("full_name")
      : { data: [] as [] };

  type RawGuide = Pick<
    Profile,
    "id" | "full_name" | "status" | "invited_at"
  > & { role: "aims_guide" | "system_admin" };
  const guides = [
    ...((guideRows ?? []) as RawGuide[]),
    ...((sysadminRows ?? []) as RawGuide[]),
  ];
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

  return guides.map((g) => ({
    id: g.id,
    full_name: g.full_name,
    status: g.status,
    invited_at: g.invited_at,
    role: g.role,
    email: null,
    assignments: assignmentsByGuide.get(g.id) ?? [],
  }));
}

// System admins the caller can add as a working guide on companies.
// Rendered in the "Give a system admin a coaching caseload" mini-form
// on the Guides panel. Every sysadmin profile is eligible — including
// ones already carrying a caseload, so a sysadmin can top up their
// own list without leaving the panel.
export type CaseloadCandidate = Pick<Profile, "id" | "full_name">;

export async function getSysadminsForCaseloadPicker(): Promise<
  CaseloadCandidate[]
> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "system_admin")
    .order("full_name");
  return (data ?? []) as CaseloadCandidate[];
}
