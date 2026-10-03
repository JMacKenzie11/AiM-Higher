import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { todayInTimezone } from "@/lib/dates";
import { getCascade, type CascadeGoal, type CascadePriority } from "@/lib/plan/service";
import { loadMeasuresSpine } from "@/lib/measures/spine";
import { computeStatus } from "@/lib/measures/board";
import { formatMeasureValue, parseScale, parseTypedNumber } from "@/lib/measures/value-format";
import { groupTargetHistory, targetInForce } from "@/lib/measures/target-history";
import type { CoachTool } from "./tools";

// WHAT THE COMPANY IS WORKING ON NOW (Jason, 2026-10-03).
//
// Benson asked Aimee "What are our goals?" in her panel, and she could
// not say: her planning tool reads closed quarters only, Benson had
// never closed one, and nothing else gave her the plan, the open
// issues or this week's numbers. history-tools.ts is the record of
// what happened; these three are the live state beside it:
//
//   current_plan   the open quarter's focus areas, goals and
//                  priorities, as Goals & Priorities shows them
//   open_issues    the issues still open, with the commitments taken
//                  against each
//   measures_now   every Critical Success Factor measure's last four
//                  weeks against the target in force each week
//
// Same rules as the history tools. Every read is on the CALLER's
// client, through the loaders the pages themselves use (getCascade,
// loadMeasuresSpine), so a tool returns what that person could open in
// the product and nothing more (E5). Identifiers are closed over: the
// model chooses nothing but how much. Nothing here reads anyone's
// conversations or memory (live-tools.test.ts holds the source to it).
// Tools never throw; expected-empty is a status.

const MAX_ISSUES = 15;
const MAX_COMMITMENTS_PER_ISSUE = 6;
const MEASURE_WEEKS = 4;

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function companyTimezone(db: Db, companyId: string): Promise<string> {
  const { data } = await db.from("companies").select("timezone").eq("id", companyId).maybeSingle<{ timezone: string | null }>();
  return data?.timezone ?? "UTC";
}

export function buildLiveTools(args: { companyId: string }): CoachTool[] {
  return [makeCurrentPlanTool(args), makeOpenIssuesTool(args), makeMeasuresNowTool(args)];
}

// ---- current_plan -----------------------------------------------

const priorityLine = (p: CascadePriority) => ({
  title: p.title,
  owner: p.owner?.full_name ?? null,
  status: p.status,
  due: p.due_date,
  progress_pct: p.percent,
  commitments: { kept: p.kept_count, open: p.open_count, missed: p.missed_count, carried: p.carried_count },
});
const goalLine = (g: CascadeGoal) => ({
  title: g.title,
  owner: g.owner?.full_name ?? null,
  status: g.status,
  target_date: g.target_date,
  progress_pct: g.percent,
  priorities: g.priorities.map(priorityLine),
});

function makeCurrentPlanTool(args: { companyId: string }): CoachTool {
  return {
    definition: {
      name: "current_plan",
      description:
        "The company's plan as it stands now, as the Goals & Priorities page shows it: each strategic focus area with its sponsor, its annual goals and the open quarter's priorities, with owner, status, due date and progress, plus goals and priorities that sit under no focus area. " +
        "Use it for 'what are our goals', 'what are we working on this quarter', 'what does Sam own'. The quarter is flagged lapsed when its end date has passed and nobody has rolled it. Returns status='no_open_quarter' (with the focus areas and goals, and no priorities) when no quarter is open, and status='empty' when nothing has been planned.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const db = await createSupabaseServerClient(getCurrentInstanceConfig());
      const [{ data: quarter }, tz] = await Promise.all([
        db
          .from("quarters")
          .select("id, label, start_date, end_date")
          .eq("company_id", args.companyId)
          .eq("status", "open")
          .order("end_date", { ascending: false })
          .limit(1)
          .maybeSingle<{ id: string; label: string; start_date: string; end_date: string }>(),
        companyTimezone(db, args.companyId),
      ]);
      const cascade = await getCascade(args.companyId, quarter?.id ?? null);
      const plan = {
        focus_areas: cascade.sfas.map((s) => ({
          title: s.title,
          sponsor: s.sponsor?.full_name ?? null,
          status: s.status,
          progress_pct: s.percent,
          goals: s.goals.map(goalLine),
          priorities: s.priorities.map(priorityLine),
        })),
        goals_without_focus_area: cascade.orphanGoals.map(goalLine),
        priorities_without_goal: cascade.orphanPriorities.map(priorityLine),
      };
      const nothing =
        plan.focus_areas.length === 0 && plan.goals_without_focus_area.length === 0 && plan.priorities_without_goal.length === 0;
      if (nothing) return { status: "empty" as const, reason: "nothing has been planned" };
      if (!quarter) return { status: "no_open_quarter" as const, ...plan };
      const { iso: today } = todayInTimezone(tz);
      return {
        status: "ok" as const,
        quarter: { label: quarter.label, starts: quarter.start_date, ends: quarter.end_date, lapsed: quarter.end_date < today },
        ...plan,
      };
    },
  };
}

// ---- open_issues ------------------------------------------------

function makeOpenIssuesTool(args: { companyId: string }): CoachTool {
  return {
    definition: {
      name: "open_issues",
      description:
        `The company's open issues, in their ranked order, as the Issues page shows them: the problem, what is wanted, when it was raised, and the commitments taken against it so far (up to ${MAX_COMMITMENTS_PER_ISSUE} each, newest first) with owner and status. Up to ${MAX_ISSUES} issues. ` +
        "Use it for 'what are we stuck on', 'what issues are open'. For how past issues were solved, use issue_casefiles. Returns status='empty' when none are open.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const db = await createSupabaseServerClient(getCurrentInstanceConfig());
      const { data } = await db
        .from("issues")
        .select("id, title, desired_outcome, rank, created_at")
        .eq("company_id", args.companyId)
        .eq("status", "open")
        .order("rank", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(MAX_ISSUES + 1);
      const all = (data ?? []) as Array<{ id: string; title: string; desired_outcome: string | null; rank: number | null; created_at: string }>;
      if (all.length === 0) return { status: "empty" as const, reason: "no open issues" };
      const issues = all.slice(0, MAX_ISSUES);

      const [{ data: commitments }, { data: people }] = await Promise.all([
        db
          .from("commitments")
          .select("issue_id, description, status, due_date, owner_id, created_at")
          .in(
            "issue_id",
            issues.map((i) => i.id)
          )
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        db.from("profiles").select("id, full_name").eq("company_id", args.companyId),
      ]);
      const nameOf = new Map(((people ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p.full_name]));
      const byIssue = new Map<string, Array<{ description: string; status: string; due_date: string | null; owner_id: string | null }>>();
      for (const c of (commitments ?? []) as Array<{ issue_id: string; description: string; status: string; due_date: string | null; owner_id: string | null }>) {
        const list = byIssue.get(c.issue_id) ?? [];
        list.push(c);
        byIssue.set(c.issue_id, list);
      }

      return {
        status: "ok" as const,
        truncated: all.length > MAX_ISSUES,
        issues: issues.map((i) => {
          const taken = byIssue.get(i.id) ?? [];
          return {
            title: i.title,
            wanted: i.desired_outcome,
            raised: i.created_at.slice(0, 10),
            commitments_taken: taken.length,
            commitments: taken.slice(0, MAX_COMMITMENTS_PER_ISSUE).map((c) => ({
              description: c.description,
              owner: c.owner_id ? nameOf.get(c.owner_id) ?? null : null,
              status: c.status,
              due: c.due_date,
            })),
          };
        }),
      };
    },
  };
}

// ---- measures_now -----------------------------------------------

function makeMeasuresNowTool(args: { companyId: string }): CoachTool {
  return {
    definition: {
      name: "measures_now",
      description:
        `Every Critical Success Factor measure, by function, with its current target and its last ${MEASURE_WEEKS} weeks: the value logged and whether it met the target in force that week (good, off, unlogged or no_target). Weeks end on Friday; the newest may still be in progress. ` +
        "Use it for 'how are our numbers', 'what is off target', 'is Pounds Processed on track'. For the discipline scorecard's trend, use scorecard_trajectory. Returns status='empty' when the company has no measures.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const db = await createSupabaseServerClient(getCurrentInstanceConfig());
      const tz = await companyTimezone(db, args.companyId);
      const spine = await loadMeasuresSpine(args.companyId, tz);
      if (spine.csfRows.length === 0) return { status: "empty" as const, reason: "no measures" };

      const weeks = spine.weeks.slice(-MEASURE_WEEKS).reverse();
      const fnById = new Map(spine.functions.map((f) => [f.id, f]));
      const nameOf = new Map(spine.roster.map((r) => [r.id, r.full_name]));
      const targets = groupTargetHistory(spine.targetRows);
      const entry = new Map(spine.entryRows.map((e) => [`${e.measure_id}|${e.week_ending}`, { number: e.value_number, text: e.value_text }]));

      return {
        status: "ok" as const,
        current_week_ending: spine.weekEnding,
        measures: [...spine.csfRows]
          .sort((a, b) => {
            const fa = fnById.get(a.function_id)?.sort_order ?? 0;
            const fb = fnById.get(b.function_id)?.sort_order ?? 0;
            return fa - fb || a.sort_order - b.sort_order;
          })
          .map((m) => {
            const fn = fnById.get(m.function_id);
            const scale = parseScale(m.value_scale);
            const history = targets.get(m.id) ?? [];
            return {
              function: fn?.title ?? null,
              function_lead: fn?.lead_id ? nameOf.get(fn.lead_id) ?? null : null,
              measure: m.description,
              // As the grid writes it (MeasuresGrid's target cell).
              target: m.target
                ? formatMeasureValue(m.value_type, scale, { number: parseTypedNumber(m.target), text: m.target }, m.target)
                : null,
              higher_is_better: m.target_direction !== "lower_is_better",
              weeks: weeks.map((w) => {
                const value = entry.get(`${m.id}|${w}`) ?? null;
                const inForce = targetInForce(history, w);
                return {
                  week_ending: w,
                  value: formatMeasureValue(m.value_type, scale, value) || null,
                  status: inForce
                    ? computeStatus({ target: inForce.target, valueType: inForce.valueType, direction: inForce.targetDirection }, value)
                    : value
                      ? "no_target"
                      : "unlogged",
                };
              }),
            };
          }),
      };
    },
  };
}
