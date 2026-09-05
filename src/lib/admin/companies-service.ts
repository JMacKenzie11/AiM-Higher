import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { groupBy } from "@/lib/utils";
import { computeFollowThrough } from "@/lib/commitments/follow-through";
import { todayInTimezone } from "@/lib/dates";
import type { Commitment, Company, Quarter } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Read model for the polished /admin/companies overview.
// Aggregates per-company signal so the system_admin can triage at a glance.

export type CompanyOverviewRow = Company & {
  peopleCount: number;
  openQuarterLabel: string | null;
  keepRate: number | null; // 0-100
};

export async function getCompaniesOverview(): Promise<CompanyOverviewRow[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

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
      .neq("status", "inactive"),
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

  // Commitments group straight by company now. The priority lookup
  // that used to sit here existed only to reach priority-linked
  // commitments, and that filter was the bug: operational work never
  // counted.
  const commitmentRowsByCompany = new Map<
    string,
    Array<{ status: string; due_date: string | null }>
  >();
  // Overdue is judged against the viewer's own day. This list is a
  // cross-company admin view spanning timezones, so there is no single
  // company clock to use; UTC keeps every row judged the same way.
  const { iso: todayIso } = todayInTimezone("UTC");
  {
    const { data: commitmentRows } = await supabase
      .from("commitments")
      .select("company_id, status, due_date")
      .in("company_id", companyIds)
      .is("deleted_at", null)
      .is("parked_at", null);
    const commitments = (commitmentRows ?? []) as Array<{
      company_id: string;
      status: string;
      due_date: string | null;
    }>;
    // Was filtered to priority-linked commitments only, which is why
    // B&B Electric read 100% here and 62% on their own dashboard: a
    // company doing mostly operational work had almost none of it
    // counted. Now every commitment counts, matching the dashboard.
    const byCompany = groupBy(commitments, (c) => c.company_id);
    for (const [companyId, items] of byCompany.entries()) {
      commitmentRowsByCompany.set(
        companyId,
        items.map((item) => ({
          status: item.status,
          due_date: item.due_date,
        }))
      );
    }
  }

  return rows.map((company) => ({
    ...company,
    peopleCount: peopleByCompany.get(company.id) ?? 0,
    openQuarterLabel: openQuarterByCompany.get(company.id)?.label ?? null,
    keepRate: computeFollowThrough(
      commitmentRowsByCompany.get(company.id) ?? [],
      todayIso
    ),
  }));
}
