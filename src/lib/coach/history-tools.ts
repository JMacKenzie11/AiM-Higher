import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { loadCompanyScorecard } from "@/lib/maturity/service";
import { compareOverall } from "@/lib/maturity/compute";
import { splitThread } from "@/lib/issues/thread";
import { getCascade } from "@/lib/plan/service";
import type { CoachTool } from "./tools";
import {
  quarterOf,
  summarizeQuarter,
  type QuarterHistory,
  type QuarterWindow,
  type TimedCommitment,
} from "./history-shape";

// Coach history tools — the accumulated organizational record.
//
// ============================================================
// SCOPE BOUNDARY, and it is deliberate.
//
// Everything in this file reads the SHARED ORGANIZATIONAL RECORD:
// commitments and their occurrences, scorecard snapshots, issues and
// their commitment threads, the planning cascade, measures.
//
// NOTHING here reads `coaching_conversations`, `coaching_messages`,
// or anything derived from a conversation. That is not an oversight
// and not a gap to be filled opportunistically by the next tool added
// to this file. Whether the coach should be able to read what was
// said in previous coaching sessions is a real question with consent,
// confidentiality and mode-boundary consequences (a leader in "about"
// mode must not be handed what a team member said in "self" mode),
// and it is tier two's design question. Adding such a read here would
// answer it by accident.
// ============================================================
//
// RLS APPLIES. Every query below runs on the CALLER'S client, never
// the service client, so a tool returns exactly what the person
// holding the conversation could already see in the product. This is
// failure mode E5 held forward: app-layer guards are courtesy, the
// policy is the boundary, and a tool that reached for
// createSupabaseAdminClient would silently widen visibility for every
// role at once.
//
// Identifiers are CLOSED OVER, not parameters. The model chooses a
// `scope`, never a person id. RLS would refuse a cross-tenant read
// anyway, but "the model cannot name a subject" is a stronger and
// cheaper property than "the database will catch it".
//
// Tools never throw. Expected-empty is a documented status shape, so
// the model can say "there is no record here" rather than treating an
// error as an absence.

// Caps. Stated in every tool description too, because the model
// budgets its own calls better when it knows what it will get.
const MAX_QUARTERS = 6;
const MAX_WEEKS = 26;
const MAX_CASEFILES = 8;
const MAX_COMMITMENT_ROWS = 400;
const MAX_REASONS_PER_QUARTER = 8;

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.min(hi, Math.max(lo, v));
}

async function recentQuarters(
  db: Db,
  companyId: string,
  count: number
): Promise<QuarterWindow[]> {
  const { data } = await db
    .from("quarters")
    .select("id, label, start_date, end_date")
    .eq("company_id", companyId)
    .order("end_date", { ascending: false })
    .limit(count);
  return (data ?? []) as QuarterWindow[];
}

export function buildHistoryTools(args: {
  subjectProfileId: string | null;
  companyId: string;
}): CoachTool[] {
  return [
    makeCommitmentHistoryTool(args),
    makeScorecardTrajectoryTool(args),
    makeIssueCasefilesTool(args),
    makePlanningHistoryTool(args),
  ];
}

// ---- commitment_history ---------------------------------------

function makeCommitmentHistoryTool(args: {
  subjectProfileId: string | null;
  companyId: string;
}): CoachTool {
  const canScopePerson = args.subjectProfileId !== null;
  return {
    definition: {
      name: "commitment_history",
      description:
        "Completed and missed commitments by quarter, for the coaching subject or for the whole company. Returns per-quarter counts, follow-through rate, verbatim miss reasons (up to " +
        `${MAX_REASONS_PER_QUARTER} per quarter), and completion timing (early / on_time / late_in_week / late). Covers at most ${MAX_QUARTERS} quarters and ${MAX_COMMITMENT_ROWS} commitments; older or larger histories are truncated and the response says so. ` +
        (canScopePerson
          ? "scope='person' is this conversation's subject; scope='company' is everyone. "
          : "Only scope='company' is available in this conversation — there is no subject. ") +
        "Use this for questions about patterns over time. Returns status='empty' when the company has no closed quarters on record; say so rather than generalizing from nothing.",
      input_schema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: canScopePerson ? ["person", "company"] : ["company"],
            description: "Whose commitments to summarize.",
          },
          quarters_back: {
            type: "integer",
            description: `How many quarters of history, most recent first. 1-${MAX_QUARTERS}.`,
          },
        },
        required: ["scope"],
      },
    },
    handler: async (input) => {
      const raw = (input ?? {}) as { scope?: string; quarters_back?: number };
      const scope = raw.scope === "person" && canScopePerson ? "person" : "company";
      const want = clamp(raw.quarters_back, 1, MAX_QUARTERS, 4);

      const db = await createSupabaseServerClient(getCurrentInstanceConfig());
      const quarters = await recentQuarters(db, args.companyId, want);
      if (quarters.length === 0) return { status: "empty" as const, reason: "no quarters on record" };

      const oldest = quarters[quarters.length - 1]!.start_date;
      const newest = quarters[0]!.end_date;

      let q = db
        .from("commitments")
        .select("description, status, due_date, week_ending, completed_at, missed_reason")
        .eq("company_id", args.companyId)
        .is("deleted_at", null)
        .is("parked_at", null)
        .gte("week_ending", oldest)
        .lte("week_ending", newest)
        .order("week_ending", { ascending: false })
        .limit(MAX_COMMITMENT_ROWS + 1);
      if (scope === "person") q = q.eq("owner_id", args.subjectProfileId!);

      const { data } = await q;
      const all = (data ?? []) as Array<
        TimedCommitment & { description: string; missed_reason: string | null }
      >;
      const truncated = all.length > MAX_COMMITMENT_ROWS;
      const rows = truncated ? all.slice(0, MAX_COMMITMENT_ROWS) : all;

      const byQuarter = new Map<string, typeof rows>();
      for (const row of rows) {
        const qtr = quarterOf(row, quarters);
        if (!qtr) continue;
        const bucket = byQuarter.get(qtr.label) ?? [];
        bucket.push(row);
        byQuarter.set(qtr.label, bucket);
      }

      const summaries: Array<QuarterHistory & { miss_reasons: string[] }> = [];
      for (const qtr of quarters) {
        const bucket = byQuarter.get(qtr.label) ?? [];
        summaries.push({
          ...summarizeQuarter(qtr.label, bucket),
          // Verbatim, and capped. The person's own words are the most
          // coaching-useful thing in this payload; a hundred of them
          // is a context bill nobody reads.
          miss_reasons: bucket
            .filter((r) => r.status === "missed" && r.missed_reason?.trim())
            .slice(0, MAX_REASONS_PER_QUARTER)
            .map((r) => r.missed_reason!.trim()),
        });
      }

      return {
        status: "ok" as const,
        scope,
        quarters: summaries,
        truncated,
        note: truncated
          ? `Only the ${MAX_COMMITMENT_ROWS} most recent commitments were read; earlier quarters may undercount.`
          : undefined,
      };
    },
  };
}

// ---- scorecard_trajectory -------------------------------------

function makeScorecardTrajectoryTool(args: { companyId: string }): CoachTool {
  return {
    definition: {
      name: "scorecard_trajectory",
      description:
        `The company's weekly scorecard history, per discipline, for up to ${MAX_WEEKS} weeks. ` +
        "Also returns a then-versus-now overall comparison computed over ONLY the disciplines present at both ends, with the count of disciplines compared. Use that comparison rather than subtracting two overall scores yourself: a company that switched a module on mid-window has two overalls built from different disciplines, and subtracting them invents a change nobody caused. Returns status='empty' when there are fewer than two snapshots.",
      input_schema: {
        type: "object",
        properties: {
          weeks_back: {
            type: "integer",
            description: `How many weeks of history. 2-${MAX_WEEKS}.`,
          },
        },
        required: [],
      },
    },
    handler: async (input) => {
      const raw = (input ?? {}) as { weeks_back?: number };
      const weeks = clamp(raw.weeks_back, 2, MAX_WEEKS, 12);

      // Reused wholesale. loadCompanyScorecard already assembles the
      // per-discipline series AND an overall series carrying the
      // discipline scores each point was built from — which is
      // precisely what the comparison below needs and precisely what
      // would be lost by querying the snapshot table directly.
      const scorecard = await loadCompanyScorecard(args.companyId);
      const overall = scorecard.overallTimeseries.slice(-weeks);
      if (overall.length < 2) {
        return { status: "empty" as const, reason: "fewer than two snapshots on record" };
      }

      const first = overall[0]!;
      const last = overall[overall.length - 1]!;
      const comparison = compareOverall(first.scores, last.scores);

      const series: Record<string, Array<{ date: string; score: number | null }>> = {};
      for (const [key, points] of Object.entries(scorecard.timeseries)) {
        const tail = points.slice(-weeks);
        if (tail.some((p) => p.score !== null)) series[key] = tail;
      }

      return {
        status: "ok" as const,
        weeks_covered: overall.length,
        from: first.date,
        to: last.date,
        per_discipline: series,
        overall_comparison: comparison
          ? {
              then: comparison.then,
              now: comparison.now,
              delta: comparison.delta,
              disciplines_compared: comparison.disciplinesCompared,
            }
          : null,
        comparison_note:
          comparison === null
            ? "No discipline scored at both ends of this window, so there is no like-for-like comparison to make."
            : `Computed over the ${comparison.disciplinesCompared} discipline(s) scored at both ends.`,
      };
    },
  };
}

// ---- issue_casefiles ------------------------------------------

function makeIssueCasefilesTool(args: { companyId: string }): CoachTool {
  return {
    definition: {
      name: "issue_casefiles",
      description:
        `Resolved issues with the full sequence of commitments taken against each one: the problem, what was wanted, what was tried in order, what closed it, and days from raised to resolved. Up to ${MAX_CASEFILES} issues, most recently resolved first. ` +
        "Use this for 'how has this team solved things like this before'. Returns status='empty' when no issues have been resolved in the window.",
      input_schema: {
        type: "object",
        properties: {
          resolved_within_quarters: {
            type: "integer",
            description: `Look back this many quarters. 1-${MAX_QUARTERS}.`,
          },
        },
        required: [],
      },
    },
    handler: async (input) => {
      const raw = (input ?? {}) as { resolved_within_quarters?: number };
      const want = clamp(raw.resolved_within_quarters, 1, MAX_QUARTERS, 2);

      const db = await createSupabaseServerClient(getCurrentInstanceConfig());
      const quarters = await recentQuarters(db, args.companyId, want);
      const since =
        quarters.length > 0
          ? quarters[quarters.length - 1]!.start_date
          : new Date(Date.now() - want * 90 * 864e5).toISOString().slice(0, 10);

      const { data: issueRows } = await db
        .from("issues")
        .select("id, title, desired_outcome, created_at, resolved_at, resolved_in_meeting")
        .eq("company_id", args.companyId)
        .eq("status", "resolved")
        .gte("resolved_at", since)
        .order("resolved_at", { ascending: false })
        .limit(MAX_CASEFILES);
      const issues = (issueRows ?? []) as Array<{
        id: string;
        title: string;
        desired_outcome: string | null;
        created_at: string;
        resolved_at: string | null;
        resolved_in_meeting: boolean | null;
      }>;
      if (issues.length === 0) {
        return { status: "empty" as const, reason: "no issues resolved in this window" };
      }

      const { data: cmtRows } = await db
        .from("commitments")
        .select("id, issue_id, description, status, due_date, week_ending, completed_at, missed_reason, created_at, owner_id, parked_at, deleted_at")
        .in(
          "issue_id",
          issues.map((i) => i.id)
        )
        .is("deleted_at", null);
      const commitments = (cmtRows ?? []) as Array<
        Parameters<typeof splitThread>[0][number]
      >;

      const casefiles = issues.map((issue) => {
        const mine = commitments.filter(
          (c) => (c as { issue_id: string | null }).issue_id === issue.id
        );
        // Reused, not reimplemented: splitThread is the one definition
        // of a commitment thread's order, and /issues renders from it.
        const thread = splitThread(mine);
        const ordered = [
          ...thread.completed,
          ...(thread.active ? [thread.active] : []),
          ...thread.otherOpen,
        ];
        const days =
          issue.resolved_at
            ? Math.max(
                0,
                Math.round(
                  (Date.parse(issue.resolved_at) - Date.parse(issue.created_at)) /
                    864e5
                )
              )
            : null;
        return {
          issue: issue.title,
          what_we_wanted: issue.desired_outcome,
          resolved_in_meeting: issue.resolved_in_meeting === true,
          days_to_resolution: days,
          attempts: ordered.map((c, i) => ({
            order: i + 1,
            commitment: c.description,
            outcome: c.status,
            missed_reason: c.missed_reason ?? null,
          })),
          attempt_count: ordered.length,
        };
      });

      return { status: "ok" as const, since, casefiles };
    },
  };
}

// ---- planning_history -----------------------------------------

function makePlanningHistoryTool(args: { companyId: string }): CoachTool {
  return {
    definition: {
      name: "planning_history",
      description:
        `What past quarters PLANNED, against what landed: strategic focus areas, annual goals and quarterly priorities with their final status, for up to ${MAX_QUARTERS} quarters. ` +
        "Use this for 'what did we say we would do, and what actually happened'. Returns status='empty' when the company has no closed quarters on record.",
      input_schema: {
        type: "object",
        properties: {
          quarters_back: {
            type: "integer",
            description: `How many quarters, most recent first. 1-${MAX_QUARTERS}.`,
          },
        },
        required: [],
      },
    },
    handler: async (input) => {
      const raw = (input ?? {}) as { quarters_back?: number };
      // Lower default than the others on purpose: getCascade is four
      // queries per quarter, so this is the most expensive tool here.
      const want = clamp(raw.quarters_back, 1, MAX_QUARTERS, 2);

      const db = await createSupabaseServerClient(getCurrentInstanceConfig());
      const { data } = await db
        .from("quarters")
        .select("id, label, start_date, end_date, status")
        .eq("company_id", args.companyId)
        .eq("status", "closed")
        .order("end_date", { ascending: false })
        .limit(want);
      const quarters = (data ?? []) as Array<QuarterWindow & { status: string }>;
      if (quarters.length === 0) {
        return { status: "empty" as const, reason: "no closed quarters on record" };
      }

      const cascades = await Promise.all(
        quarters.map((q) => getCascade(args.companyId, q.id))
      );

      return {
        status: "ok" as const,
        quarters: quarters.map((q, i) => {
          const c = cascades[i]!;
          const priorities = [
            ...c.sfas.flatMap((s) => s.goals.flatMap((g) => g.priorities)),
            ...c.orphanGoals.flatMap((g) => g.priorities),
            ...c.orphanPriorities,
          ];
          return {
            quarter: q.label,
            strategic_focus_areas: c.sfas.map((s) => s.title),
            goals: [
              ...c.sfas.flatMap((s) => s.goals),
              ...c.orphanGoals,
            ].map((g) => ({ title: g.title, status: g.status })),
            priorities: priorities.map((p) => ({
              title: p.title,
              status: p.status,
            })),
            priority_counts: priorities.reduce<Record<string, number>>(
              (acc, p) => {
                acc[p.status] = (acc[p.status] ?? 0) + 1;
                return acc;
              },
              {}
            ),
          };
        }),
      };
    },
  };
}
