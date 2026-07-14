import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeFollowThroughRate, groupBy } from "@/lib/utils";
import type { Commitment, Company, Quarter } from "@/lib/types";

// Read model for the polished /admin/companies overview.
// Aggregates per-company signal so the system_admin can triage at a glance.

export type CompanyOverviewRow = Company & {
  peopleCount: number;
  openQuarterLabel: string | null;
  keepRate: number | null; // 0-100
};

export async function getCompaniesOverview(): Promise<CompanyOverviewRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data: companies } = await supabase
    .from("companies")
    .select("*")
    .order("name");
  const rows = (companies ?? []) as Company[];
  if (rows.length === 0) return [];

  const companyIds = rows.map((c) => c.id);

  // Four flat queries instead of the previous N+1 loop (was ~2 + 2N).
  // We fetch every company's people count + open-quarter label + every
  // priority in those open quarters, then every commitment for those
  // priorities, and stitch the follow-through rate in memory.
  const [
    { data: profileRows },
    { data: openQuarterRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("company_id")
      .in("company_id", companyIds)
      .eq("status", "active"),
    supabase
      .from("quarters")
      .select("id, company_id, label")
      .in("company_id", companyIds)
      .eq("status", "open"),
  ]);

  const peopleByCompany = new Map<string, number>();
  for (const row of (profileRows ?? []) as Array<{ company_id: string }>) {
    peopleByCompany.set(
      row.company_id,
      (peopleByCompany.get(row.company_id) ?? 0) + 1
    );
  }

  const openQuarters = (openQuarterRows ?? []) as Array<
    Pick<Quarter, "id" | "company_id" | "label">
  >;
  const openQuarterByCompany = new Map<string, { id: string; label: string }>(
    openQuarters.map((q) => [q.company_id, { id: q.id, label: q.label }])
  );

  // Prioritiy → owning company_id map, so we can group commitment status
  // rows by company after the batched fetch.
  const openQuarterIds = openQuarters.map((q) => q.id);
  const priorityToCompany = new Map<string, string>();
  if (openQuarterIds.length > 0) {
    const { data: priorityRows } = await supabase
      .from("priorities")
      .select("id, company_id")
      .in("quarter_id", openQuarterIds);
    const priorities = (priorityRows ?? []) as Array<{
      id: string;
      company_id: string;
    }>;
    for (const row of priorities) {
      priorityToCompany.set(row.id, row.company_id);
    }
  }
  const priorityIds = Array.from(priorityToCompany.keys());

  const commitmentStatusesByCompany = new Map<string, string[]>();
  if (priorityIds.length > 0) {
    const { data: commitmentRows } = await supabase
      .from("commitments")
      .select("priority_id, status")
      .in("priority_id", priorityIds);
    const commitments = (commitmentRows ?? []) as Array<
      Pick<Commitment, "priority_id" | "status">
    >;
    const byCompany = groupBy(commitments, (c) => {
      return priorityToCompany.get(c.priority_id) ?? "__unknown";
    });
    for (const [companyId, items] of byCompany.entries()) {
      commitmentStatusesByCompany.set(
        companyId,
        items.map((item) => item.status)
      );
    }
  }

  return rows.map((company) => ({
    ...company,
    peopleCount: peopleByCompany.get(company.id) ?? 0,
    openQuarterLabel: openQuarterByCompany.get(company.id)?.label ?? null,
    keepRate: computeFollowThroughRate(
      commitmentStatusesByCompany.get(company.id) ?? []
    ),
  }));
}
