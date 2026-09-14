import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { loadCompanyScorecardScores } from "@/lib/maturity/service";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { summarizePriorityHealth } from "@/lib/plan/priority-health";
import {
  summarizeFollowThrough,
  type FollowThroughSummary,
} from "@/lib/commitments/follow-through";
import { thisFriday, todayInTimezone } from "@/lib/dates";

// The portfolio overview behind /portfolio.
//
// OVERSIGHT, NOT COACHING. Guide HQ answers "what needs me this week"
// — an attention queue, nudges, session briefs, a feed. This answers
// "what shape is the portfolio in", which is a different question with
// a different reader. None of the coaching machinery appears here and
// none of it is imported.
//
// ---- What was reused, and what had to be new -----------------
//
// Reused unchanged, because they were already company-id-driven
// rather than guide-driven:
//
//   loadCompanyScorecardScores  (lib/maturity/service)   cached
//   getCurrentQuarter           (lib/quarters/service)   cached
//   summarizeFollowThrough      (lib/commitments/follow-through)
//   thisFriday                  (lib/dates)
//
// Extracted, because it existed inline in one page loader and this is
// the second caller:
//
//   summarizePriorityHealth     (lib/plan/priority-health)
//
// New, because the guide version is irreducibly about assignments:
//
//   loadPortfolioCompanies
//
// loadCaseload(guideId) reads guide_assignments, which is the entire
// substance of it — there is no shared core inside to lift out, only
// a two-field return shape. A portfolio_admin has no assignments by
// design (migration 0190), so their company list is "every row RLS
// will show me", which is a different query rather than a different
// argument to the same one. Writing a sibling was the honest move;
// generalising loadCaseload into something that takes an optional
// guide id would have produced one function with two unrelated bodies.

export type PortfolioCompany = {
  id: string;
  name: string;
  timezone: string;
};

// Every company on the instance, as RLS will show them.
//
// No role check and no company filter, deliberately. The caller is
// gated by requireRole and the ROWS are gated by
// companies_select_portfolio (migration 0191), which admits every
// company for this role and none for anyone who is not entitled to
// them. A filter here would be a second, weaker copy of that rule.
//
// companies_hide_deleted still applies, so soft-deleted tenants are
// absent without this having to remember them.
export async function loadPortfolioCompanies(): Promise<PortfolioCompany[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await supabase
    .from("companies")
    .select("id, name, timezone")
    .eq("status", "active")
    .order("name", { ascending: true });
  return (data ?? []) as PortfolioCompany[];
}

export type PortfolioCard = {
  id: string;
  name: string;
  // The scorecard overall, and the number of disciplines it is a mean
  // over.
  //
  // THE DENOMINATOR TRAVELS WITH THE NUMBER, and on this page that is
  // not optional. An overall is a weighted mean over whichever
  // disciplines scored, so two overalls are only comparable when they
  // cover the same set — the reasoning compareOverall sets out at
  // length in lib/maturity/compute.ts, written after four of eight
  // companies showed a false "scorecard dropped" from exactly this
  // mismatch.
  //
  // A grid of cards is an invitation to compare them. Company A at 3.2
  // over eight disciplines and company B at 3.4 over four are not
  // ranked by those numbers, and the only way a reader can know that
  // is if the card says so.
  scorecardOverall: number | null;
  scorecardDisciplines: number;
  // The open quarter, and how its priorities are doing.
  quarterLabel: string | null;
  priorityGood: number;
  priorityTotal: number;
  priorityPercent: number | null;
  // This week's commitments, judged by the one shared follow-through
  // rule rather than by a count of this page's own devising.
  week: FollowThroughSummary;
  weekEnding: string;
};

// One card per company.
//
// Per-company work rather than one batched query per metric, and that
// is a deliberate trade. The scorecard is a live compute and the week
// boundary depends on each company's own timezone, so neither can be
// answered for N companies in one round trip. Both underlying loaders
// are request-cached, and an instance holds single-digit to low-double-
// digit companies. If that stops being true this is the place to
// revisit, and the shape to revisit it into is a materialised rollup,
// not a cleverer join.
export async function loadPortfolioOverview(): Promise<PortfolioCard[]> {
  const companies = await loadPortfolioCompanies();
  if (companies.length === 0) return [];

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  return Promise.all(
    companies.map(async (company) => {
      // The week ends on Friday in the COMPANY's clock, not the
      // viewer's. A portfolio_admin reading from another timezone must
      // see the same week the company's own dashboard shows, or the
      // two surfaces disagree about what "this week" means for the
      // same rows. Migration 0189 records timezone changes for
      // exactly this class of reason.
      const tz = company.timezone ?? "America/Anchorage";
      const weekEnding = thisFriday(tz);
      // "Today" for the overdue-open bucket, also in the company's
      // clock. summarizeFollowThrough counts an open commitment
      // against the rate only once it is STRICTLY past due, so the
      // date it compares against decides whether a company reads as
      // behind on the day the deadline falls.
      const todayIso = todayInTimezone(tz).iso;

      const quarter = await getCurrentQuarter(company.id);

      const [scorecard, priorityRows, weekRows] = await Promise.all([
        // A company with no data at all makes this throw rather than
        // return zeros. A thrown scorecard must not take the whole
        // page down with it, so it degrades to "no score yet", which
        // is what a brand-new tenant honestly has.
        loadCompanyScorecardScores(company.id).catch(() => null),
        quarter
          ? supabase
              .from("priorities")
              .select("status")
              .eq("company_id", company.id)
              .eq("quarter_id", quarter.id)
              .eq("archived", false)
          : Promise.resolve({ data: [] }),
        supabase
          .from("commitments")
          .select("status, due_date")
          .eq("company_id", company.id)
          .eq("week_ending", weekEnding)
          // Soft-deleted and parked rows never count toward
          // follow-through anywhere else in the product.
          .is("deleted_at", null)
          .is("parked_at", null),
      ]);

      const priorities = summarizePriorityHealth(
        (priorityRows.data ?? []) as Array<{ status: string }>
      );

      return {
        id: company.id,
        name: company.name,
        scorecardOverall: scorecard?.overall.score ?? null,
        scorecardDisciplines: scorecard?.overall.disciplinesCounted ?? 0,
        quarterLabel: quarter?.label ?? null,
        priorityGood: priorities.good,
        priorityTotal: priorities.total,
        priorityPercent: priorities.percent,
        week: summarizeFollowThrough(
          (weekRows.data ?? []) as Array<{
            status: string;
            due_date: string | null;
          }>,
          todayIso
        ),
        weekEnding,
      };
    })
  );
}
