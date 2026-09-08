import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  summarizeFollowThroughCounts,
  type FollowThroughCounts,
} from "@/lib/commitments/follow-through";
import type { Company, Quarter } from "@/lib/types";
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

  // Three flat queries, none of which returns more than one row per
  // company except the roster count.
  const [
    { data: profileRows },
    { data: openQuarterRows },
    { data: followThroughRows, error: followThroughError },
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
    // Follow-Through, counted in the database.
    //
    // This used to select every commitment for every visible company —
    // no date bound, no limit — and reduce them here to one percentage
    // each. For a system_admin that is every live commitment on the
    // instance crossing the wire to produce a handful of integers, and
    // if a PostgREST row cap were ever configured it would silently
    // truncate and quietly wrong every rate on the page.
    //
    // The view (migration 0174) counts the same four buckets over the
    // same population, so the number is unchanged; only the place the
    // counting happens moved. It is security_invoker, so the rows it
    // groups are still filtered by the caller's own RLS. One row per
    // company.
    supabase
      .from("company_follow_through")
      .select("company_id, kept_on_time, kept_late, missed, overdue_open")
      .in("company_id", companyIds),
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

  // The view emits nothing for a company with no countable
  // commitments, which is the same thing the old code expressed as an
  // empty row list: zero in every bucket, and a null rate rather than
  // a zero. Null and zero mean very different things here — "no data"
  // versus "nothing landed on time".
  //
  // Population note kept from the previous fix: this was once filtered
  // to priority-linked commitments only, which is why B&B Electric
  // read 100% here and 62% on their own dashboard. A company doing
  // mostly operational work had almost none of it counted. Every
  // commitment counts, and the view carries that rule now.
  // Say so when the aggregate read fails. Its failure mode is the
  // quiet kind: no rows comes back indistinguishable from "no company
  // has any commitments", and every rate on the page renders as an
  // em-dash. That is what a missing view looks like before its
  // migration reaches an instance, and it must not be mistaken for
  // real data. Non-fatal — the rest of the row is still worth showing.
  // Same rule as findSimilarOpenItem.
  if (followThroughError) {
    console.error(
      "[companies] follow-through aggregate read failed; every rate on " +
        `/admin/companies will render empty: ${followThroughError.message}`
    );
  }

  const countsByCompany = new Map<string, FollowThroughCounts>();
  for (const row of (followThroughRows ?? []) as Array<{
    company_id: string;
    kept_on_time: number;
    kept_late: number;
    missed: number;
    overdue_open: number;
  }>) {
    countsByCompany.set(row.company_id, {
      keptOnTime: Number(row.kept_on_time),
      keptLate: Number(row.kept_late),
      missed: Number(row.missed),
      overdueOpen: Number(row.overdue_open),
    });
  }

  return rows.map((company) => ({
    ...company,
    peopleCount: peopleByCompany.get(company.id) ?? 0,
    openQuarterLabel: openQuarterByCompany.get(company.id)?.label ?? null,
    keepRate: summarizeFollowThroughCounts(
      countsByCompany.get(company.id) ?? EMPTY_COUNTS
    ).rate,
  }));
}

const EMPTY_COUNTS: FollowThroughCounts = {
  keptOnTime: 0,
  keptLate: 0,
  missed: 0,
  overdueOpen: 0,
};
