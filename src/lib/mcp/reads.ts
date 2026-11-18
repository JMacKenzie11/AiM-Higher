import "server-only";
import { notesForReader } from "@/lib/notes/clean";

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, fridayOf, thisFriday, mondayOf, todayInTimezone } from "@/lib/dates";
import { isOffTarget } from "@/lib/measures/off-target";
import { targetInForce, type TargetHistoryRow } from "@/lib/measures/target-history";
import { summarizeFollowThrough } from "@/lib/commitments/follow-through";
import { summarizePriorityHealth } from "@/lib/plan/priority-health";
import type { MetricValueType, TargetDirection } from "@/lib/types";
import { orderFunctionsByHierarchy, weeksBack } from "@/lib/measures/spine";
import type { VisibleCompany } from "./company";

// THE READ MENU (Phase 2). Jason, 2026-10-13 and 2026-10-14: my
// commitments, my team's commitments, measures with recent values, open
// issues, meeting summaries, the functional chart, and the companies I
// can see. Not transcripts, not facilitation reviews, nothing of Aimee.
//
// EVERY QUERY RUNS ON THE ASSISTANT'S TOKEN, as the person: their own
// access rules decide what comes back, and the allow list (0270) refuses
// anything off the menu at the database whatever this file asks for.
//
// FIXED COLUMNS. Every select names its columns, and every answer is
// built field by field from them, so a column added to a table later
// never reaches an assistant by accident. reads.test.ts holds this file
// to it.

export class ReadFailed extends Error {
  constructor(public readonly code: string) {
    super(`read_failed:${code}`);
  }
}

type Db = SupabaseClient;
type Ctx = { db: Db; userId: string; company: VisibleCompany };

function must<T>(res: { data: T | null; error: { code?: string } | null }): T {
  if (res.error) throw new ReadFailed(res.error.code ?? "unknown");
  return (res.data ?? ([] as unknown)) as T;
}

// ---- companies ---------------------------------------------------------

export async function visibleCompanies(db: Db): Promise<VisibleCompany[]> {
  const rows = must(
    await db.from("companies").select("id, name, assistants_enabled").is("deleted_at", null).order("name")
  ) as Array<{ id: string; name: string; assistants_enabled: boolean }>;
  return rows.map((r) => ({ id: r.id, name: r.name, assistantsOn: r.assistants_enabled === true }));
}

// Each company's main contact, its AiMS champion, and its AiMS Coaches,
// by name, for list_my_companies (Jason, 2026-11-18): so "do Benson"
// can be matched to Benson Seafood and its people. A name the person
// cannot read comes back null.
export async function companyContacts(db: Db, companyIds: string[]) {
  if (companyIds.length === 0) return new Map<string, { champion: string | null; coaches: string[] }>();
  const [cos, guides] = await Promise.all([
    db
      .from("companies")
      .select("id, aims_champion_profile_id")
      .in("id", companyIds)
      .then((res) => must(res) as Array<{ id: string; aims_champion_profile_id: string | null }>),
    db
      .from("guide_assignments")
      .select("guide_id, company_id")
      .in("company_id", companyIds)
      .then((res) => must(res) as Array<{ guide_id: string; company_id: string }>),
  ]);
  const ids = [...new Set([...cos.map((c) => c.aims_champion_profile_id), ...guides.map((g) => g.guide_id)].filter((x): x is string => !!x))];
  const people = ids.length
    ? (must(await db.from("profiles").select("id, full_name").in("id", ids)) as Array<{ id: string; full_name: string | null }>)
    : [];
  const name = new Map(people.map((p) => [p.id, p.full_name]));
  const out = new Map<string, { champion: string | null; coaches: string[] }>();
  for (const c of cos) {
    out.set(c.id, {
      champion: c.aims_champion_profile_id ? name.get(c.aims_champion_profile_id) ?? null : null,
      coaches: guides
        .filter((g) => g.company_id === c.id)
        .map((g) => name.get(g.guide_id))
        .filter((n): n is string => !!n),
    });
  }
  return out;
}

async function companyTimezone(db: Db, companyId: string): Promise<string> {
  const rows = must(
    await db.from("companies").select("timezone").eq("id", companyId).limit(1)
  ) as Array<{ timezone: string | null }>;
  return rows[0]?.timezone ?? "America/Anchorage";
}

async function roster(db: Db, companyId: string): Promise<Map<string, string>> {
  const rows = must(
    await db.from("profiles").select("id, full_name").eq("company_id", companyId)
  ) as Array<{ id: string; full_name: string | null }>;
  return new Map(rows.map((r) => [r.id, r.full_name ?? "Unnamed"]));
}

// ---- commitments -------------------------------------------------------

const COMMITMENT_COLS =
  "id, owner_id, description, due_date, due_date_defaulted, status, is_ongoing, parked_at, completed_at, priority_id, issue_id, functional_area_id, notes";

type CommitmentRow = {
  id: string;
  // Company data like the rest of the row, and on the menu with it
  // (Jason, 2026-10-16). Read as plain text (notesForReader).
  notes?: unknown;
  owner_id: string | null;
  description: string;
  due_date: string;
  due_date_defaulted: boolean;
  status: string;
  is_ongoing: boolean;
  parked_at: string | null;
  completed_at: string | null;
  priority_id: string | null;
  issue_id: string | null;
  functional_area_id: string | null;
};

const linkOf = (r: CommitmentRow) =>
  r.priority_id ? "priority" : r.issue_id ? "issue" : r.functional_area_id ? "functional_area" : null;

// The person's own: everything open (parked included, and said so), and
// what they resolved in the last four weeks. A repeating commitment
// carries its last four weeks' results.
export async function myCommitments({ db, userId, company }: Ctx) {
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const rows = must(
    await db
      .from("commitments")
      .select(COMMITMENT_COLS)
      .eq("company_id", company.id)
      .eq("owner_id", userId)
      .is("deleted_at", null)
      .or(`status.eq.open,completed_at.gte.${since}`)
      .order("due_date")
      .limit(200)
  ) as CommitmentRow[];

  const ongoingIds = rows.filter((r) => r.is_ongoing).map((r) => r.id);
  const issueIds = [...new Set(rows.map((r) => r.issue_id).filter((x): x is string => !!x))];
  const [weeks, issues] = await Promise.all([
    ongoingIds.length
      ? (must(
          await db
            .from("commitment_occurrences")
            .select("commitment_id, week_ending, status")
            .in("commitment_id", ongoingIds)
            .gte("week_ending", since.slice(0, 10))
            .order("week_ending", { ascending: false })
        ) as Array<{ commitment_id: string; week_ending: string; status: string }>)
      : [],
    issueIds.length
      ? (must(await db.from("issues").select("id, title").in("id", issueIds)) as Array<{ id: string; title: string }>)
      : [],
  ]);
  const issueTitle = new Map(issues.map((i) => [i.id, i.title]));

  const commitments = rows.map((r) => ({
    id: r.id,
    description: r.description,
    due_date: r.due_date,
    due_date_was_defaulted: r.due_date_defaulted,
    status: r.status,
    repeats_weekly: r.is_ongoing,
    parked: r.parked_at !== null,
    resolved_at: r.completed_at,
    linked_to: linkOf(r),
    issue_title: r.issue_id ? issueTitle.get(r.issue_id) ?? null : null,
    notes: notesForReader(r.notes),
    recent_weeks: r.is_ongoing
      ? weeks
          .filter((w) => w.commitment_id === r.id)
          .map((w) => ({ week_beginning: mondayOf(w.week_ending), status: w.status }))
      : undefined,
  }));
  return { company: company.name, commitments };
}

// Everyone else's open commitments in the company, and the unassigned
// ones: what the /commitments page shows a team member. Parked work is
// left out, as it is from the weekly flow.
export async function teamCommitments({ db, userId, company }: Ctx) {
  const [rows, names] = await Promise.all([
    db
      .from("commitments")
      .select(COMMITMENT_COLS)
      .eq("company_id", company.id)
      .eq("status", "open")
      .is("deleted_at", null)
      .is("parked_at", null)
      .or(`owner_id.is.null,owner_id.neq.${userId}`)
      .order("due_date")
      .limit(300)
      .then((res) => must(res) as CommitmentRow[]),
    roster(db, company.id),
  ]);
  const commitments = rows.map((r) => ({
    id: r.id,
    owner: r.owner_id ? names.get(r.owner_id) ?? null : null,
    description: r.description,
    due_date: r.due_date,
    repeats_weekly: r.is_ongoing,
    linked_to: linkOf(r),
    notes: notesForReader(r.notes),
  }));
  return { company: company.name, commitments };
}

// ---- measures ----------------------------------------------------------

export type MeasureWindow = { weeks?: number; from?: string; to?: string };

// The weeks asked for, as week-ending Fridays, oldest first. A date
// range wins over a count; either way at most 52 weeks.
export function measureWeeks(timezone: string, w: MeasureWindow): string[] {
  const last = w.to ? fridayOf(w.to) : thisFriday(timezone);
  if (w.from) {
    const first = fridayOf(w.from);
    const out: string[] = [];
    for (let f = first; f <= last && out.length < 52; f = addDays(f, 7)) out.push(f);
    return out;
  }
  return weeksBack(last, Math.min(Math.max(w.weeks ?? 6, 1), 52));
}

type MeasureRow = {
  id: string;
  function_id: string;
  description: string;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  update_frequency: string | null;
};
type EntryRow = { measure_id: string; week_ending: string; value_number: number | null; value_text: string | null };

// Whether a week's value met the target in force that week (the target
// history, so lowering a target later does not turn old misses into
// hits). Null when the week is not judged: no value, or no target.
export function weekHit(
  m: Pick<MeasureRow, "target" | "value_type" | "target_direction">,
  history: readonly TargetHistoryRow[],
  e: Pick<EntryRow, "week_ending" | "value_number" | "value_text">
): { target: string | null; hit: boolean | null } {
  const inForce = history.length > 0 ? targetInForce(history, e.week_ending) : m.target ? { target: m.target, valueType: m.value_type, targetDirection: m.target_direction } : null;
  if (!inForce) return { target: null, hit: null };
  const empty = inForce.valueType === "text" ? !(e.value_text ?? "").trim() : e.value_number == null;
  if (empty) return { target: inForce.target, hit: null };
  const off = isOffTarget(
    { id: "", description: "", target: inForce.target, value_type: inForce.valueType, target_direction: inForce.targetDirection },
    { number: e.value_number, text: e.value_text }
  );
  return { target: inForce.target, hit: !off };
}

// Weeks in a row, newest back, that met target. A week with no value or
// no target ends the run.
export function streakOf(results: ReadonlyArray<{ hit: boolean | null }>): number {
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i].hit === true; i--) n++;
  return n;
}

async function loadMeasures(db: Db, companyId: string, weeks: string[]) {
  const [fns, names] = await Promise.all([
    db
      .from("functions")
      .select("id, title, parent_function_id, lead_id, sort_order")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order")
      .then((res) => must(res) as Array<{ id: string; title: string; parent_function_id: string | null; lead_id: string | null; sort_order: number }>),
    roster(db, companyId),
  ]);
  const ordered = orderFunctionsByHierarchy(fns);
  const ms = ordered.length
    ? (must(
        await db
          .from("success_measures")
          .select("id, function_id, description, target, value_type, target_direction, update_frequency, sort_order")
          .in("function_id", ordered.map((f) => f.id))
          .eq("archived", false)
          .order("sort_order")
      ) as MeasureRow[])
    : [];
  const ids = ms.map((m) => m.id);
  const [entries, history] = ids.length
    ? await Promise.all([
        db
          .from("success_measure_entries")
          .select("measure_id, week_ending, value_number, value_text")
          .in("measure_id", ids)
          .gte("week_ending", weeks[0])
          .lte("week_ending", weeks[weeks.length - 1])
          .order("week_ending")
          .then((res) => must(res) as EntryRow[]),
        db
          .from("success_measure_targets")
          .select("measure_id, target, value_type, target_direction, effective_from")
          .in("measure_id", ids)
          .then((res) => must(res) as TargetHistoryRow[]),
      ])
    : [[] as EntryRow[], [] as TargetHistoryRow[]];
  return { ordered, names, ms, entries, history };
}

export async function measures({ db, company }: Ctx, window: MeasureWindow) {
  const timezone = await companyTimezone(db, company.id);
  const weeks = measureWeeks(timezone, window);
  const { ordered, names, ms, entries, history } = await loadMeasures(db, company.id, weeks);

  const functions = ordered
    .map((f) => ({
      function: f.title,
      lead: f.lead_id ? names.get(f.lead_id) ?? null : null,
      measures: ms
        .filter((m) => m.function_id === f.id)
        .map((m) => {
          const own = history.filter((h) => h.measure_id === m.id);
          const values = entries
            .filter((e) => e.measure_id === m.id)
            .map((e) => ({ e, judged: weekHit(m, own, e) }));
          return {
            id: m.id,
            measure: m.description,
            // The Lead of its function owns it; AiMS has no other owner.
            owner: f.lead_id ? names.get(f.lead_id) ?? null : null,
            target: m.target,
            better_when: m.target_direction === "lower_is_better" ? "lower" : "higher",
            value_type: m.value_type,
            frequency: m.update_frequency ?? "weekly",
            weeks_on_target_in_a_row: streakOf(values.map((v) => v.judged)),
            values: [...values].reverse().map(({ e, judged }) => ({
              week_beginning: mondayOf(e.week_ending),
              value: m.value_type === "text" ? e.value_text : e.value_number,
              target_that_week: judged.target,
              hit_target: judged.hit,
            })),
          };
        }),
    }))
    .filter((f) => f.measures.length > 0);
  return {
    company: company.name,
    this_week_beginning: mondayOf(thisFriday(timezone)),
    from_week_beginning: mondayOf(weeks[0]),
    to_week_beginning: mondayOf(weeks[weeks.length - 1]),
    functions,
  };
}

// ---- the dashboard snapshot ---------------------------------------------

// The numbers on the company's dashboard, by the same rules
// (dashboard/service.ts): the open quarter's priorities (on track and
// complete count as good, priority-health.ts), Follow-Through Rate on
// the open quarter's commitments (follow-through.ts: kept on time over
// kept, late, missed and overdue; parked and deleted left out), and the
// critical success factors on target several weeks running.
export async function dashboardSnapshot({ db, company }: Ctx) {
  const timezone = await companyTimezone(db, company.id);
  const today = todayInTimezone(timezone).iso;
  const quarters = must(
    await db.from("quarters").select("id, label, start_date, end_date, status").eq("company_id", company.id).order("start_date", { ascending: false })
  ) as Array<{ id: string; label: string; start_date: string; end_date: string; status: string }>;
  const quarter = quarters.find((q) => q.status === "open") ?? null;

  const [priorities, commitments] = quarter
    ? await Promise.all([
        db
          .from("priorities")
          .select("id, status, archived")
          .eq("company_id", company.id)
          .eq("quarter_id", quarter.id)
          .eq("archived", false)
          .then((res) => must(res) as Array<{ id: string; status: string; archived: boolean }>),
        db
          .from("commitments")
          .select("status, due_date")
          .eq("company_id", company.id)
          .gte("week_ending", quarter.start_date)
          .lte("week_ending", quarter.end_date)
          .is("deleted_at", null)
          .is("parked_at", null)
          .then((res) => must(res) as Array<{ status: string; due_date: string | null }>),
      ])
    : [[], []];

  const health = summarizePriorityHealth(priorities);
  const ft = summarizeFollowThrough(commitments, today);

  const weeks = measureWeeks(timezone, { weeks: 13 });
  const { ms, entries, history } = await loadMeasures(db, company.id, weeks);
  const streaks = ms
    .map((m) => {
      const own = history.filter((h) => h.measure_id === m.id);
      const judged = entries.filter((e) => e.measure_id === m.id).map((e) => weekHit(m, own, e));
      return { measure: m.description, target: m.target, weeks_on_target_in_a_row: streakOf(judged) };
    })
    .filter((s) => s.weeks_on_target_in_a_row >= 2)
    .sort((a, b) => b.weeks_on_target_in_a_row - a.weeks_on_target_in_a_row);

  return {
    company: company.name,
    quarter: quarter ? { label: quarter.label, start_date: quarter.start_date, end_date: quarter.end_date } : null,
    priorities: {
      total: health.total,
      on_track: priorities.filter((p) => p.status === "on_track").length,
      complete: priorities.filter((p) => p.status === "complete").length,
      behind: priorities.filter((p) => p.status === "behind").length,
      not_started: priorities.filter((p) => p.status === "not_started").length,
      on_track_or_complete_percent: health.percent,
    },
    follow_through: {
      percent: ft.rate,
      kept_on_time: ft.keptOnTime,
      kept_late: ft.keptLate,
      missed: ft.missed,
      open_and_overdue: ft.overdueOpen,
      rule: "Kept on time, out of every commitment kept, kept late, missed or overdue this quarter. Not-yet-due ones don't count.",
    },
    measure_streaks: streaks,
  };
}

// ---- issues ------------------------------------------------------------

export async function openIssues({ db, company }: Ctx) {
  const [rows, names] = await Promise.all([
    db
      .from("issues")
      .select("id, title, desired_outcome, notes, rank, created_at, created_by")
      .eq("company_id", company.id)
      .eq("status", "open")
      .order("rank")
      .limit(200)
      .then((res) => must(res) as Array<{ id: string; title: string; desired_outcome: string | null; notes?: unknown; rank: number; created_at: string; created_by: string | null }>),
    roster(db, company.id),
  ]);
  const issues = rows.map((r) => ({
    id: r.id,
    title: r.title,
    desired_outcome: r.desired_outcome,
    notes: notesForReader(r.notes),
    rank: r.rank,
    raised_on: r.created_at.slice(0, 10),
    raised_by: r.created_by ? names.get(r.created_by) ?? null : null,
  }));
  return { company: company.name, issues };
}

// ---- meeting summaries -------------------------------------------------

// Through assistant_meeting_summaries (0270) only: the summary and the
// commitments it found. Never the transcript, the facilitation review or
// the scores, which that function does not return.
export async function meetingSummaries({ db, company }: Ctx, limit: number) {
  const [rows, names] = await Promise.all([
    db
      .rpc("assistant_meeting_summaries", { p_company_id: company.id, p_limit: limit })
      .then((res) => must(res) as Array<{ meeting_id: string; meeting_title: string | null; held_at: string; summary: string | null; commitments: unknown; truncated: boolean }>),
    roster(db, company.id),
  ]);
  const meetings = rows.map((r) => ({
    id: r.meeting_id,
    title: r.meeting_title,
    held_on: r.held_at.slice(0, 10),
    summary: r.summary,
    summary_was_truncated: r.truncated,
    commitments_found: (Array.isArray(r.commitments) ? r.commitments : []).map((c: Record<string, unknown>) => ({
      description: typeof c.description === "string" ? c.description : null,
      owner: typeof c.owner_profile_id === "string" ? names.get(c.owner_profile_id) ?? null : null,
      due_date: typeof c.due_date === "string" ? c.due_date : null,
    })),
  }));
  return { company: company.name, meetings };
}

// ---- the functional chart ----------------------------------------------

type Part = { function_id: string; title: string; body: string | null; sort_order: number };

export async function functionalChart({ db, company }: Ctx) {
  const [fns, names] = await Promise.all([
    db
      .from("functions")
      .select("id, title, description, parent_function_id, lead_id, sort_order")
      .eq("company_id", company.id)
      .eq("archived", false)
      .order("sort_order")
      .then((res) => must(res) as Array<{ id: string; title: string; description: string | null; parent_function_id: string | null; lead_id: string | null; sort_order: number }>),
    roster(db, company.id),
  ]);
  const ordered = orderFunctionsByHierarchy(fns);
  const ids = ordered.map((f) => f.id);
  const part = async (table: string) =>
    ids.length
      ? (must(
          await db.from(table).select("function_id, title, body, sort_order").in("function_id", ids).order("sort_order")
        ) as Part[])
      : [];
  const [roles, rights, competencies] = await Promise.all([
    part("function_roles"),
    part("function_decision_rights"),
    part("function_competencies"),
  ]);
  const titleOf = new Map(ordered.map((f) => [f.id, f.title]));
  const pick = (rows: Part[], id: string) =>
    rows.filter((r) => r.function_id === id).map((r) => ({ title: r.title, detail: r.body }));
  const functions = ordered.map((f) => ({
    id: f.id,
    function: f.title,
    reports_to: f.parent_function_id ? titleOf.get(f.parent_function_id) ?? null : null,
    // The Lead holds Lead, Track and Decide: one seat.
    lead: f.lead_id ? names.get(f.lead_id) ?? null : null,
    purpose: f.description,
    roles: pick(roles, f.id),
    decision_rights: pick(rights, f.id),
    competencies: pick(competencies, f.id),
  }));
  return { company: company.name, functions };
}

// ---- the plan (0276) ---------------------------------------------------

type PlanRow = { id: string; title: string };

async function titles(db: Db, table: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = must(await db.from(table).select("id, title").in("id", ids)) as PlanRow[];
  return new Map(rows.map((r) => [r.id, r.title]));
}

const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))];

// A quarter's priorities. Left out, the quarter is the company's open
// one, or its latest if none is open. Named, it is a quarter label as the
// app shows it ("Q3 2026"), matched whole, ignoring case.
export async function quarterlyPriorities({ db, company }: Ctx, quarterLabel: string | undefined) {
  const quarters = must(
    await db
      .from("quarters")
      .select("id, label, start_date, end_date, status")
      .eq("company_id", company.id)
      .order("start_date", { ascending: false })
  ) as Array<{ id: string; label: string; start_date: string; end_date: string; status: string }>;
  const wanted = (quarterLabel ?? "").trim().toLowerCase();
  const quarter = wanted
    ? quarters.find((q) => q.label.trim().toLowerCase() === wanted)
    : quarters.find((q) => q.status === "open") ?? quarters[0];
  if (!quarter) {
    return {
      company: company.name,
      quarter: null,
      quarters_available: quarters.map((q) => q.label),
      priorities: [],
    };
  }
  const [rows, names] = await Promise.all([
    db
      .from("priorities")
      .select("id, title, description, owner_id, due_date, status, annual_goal_id, sfa_id")
      .eq("company_id", company.id)
      .eq("quarter_id", quarter.id)
      .eq("archived", false)
      .order("sort_order")
      .then((res) => must(res) as Array<{ id: string; title: string; description: string | null; owner_id: string | null; due_date: string | null; status: string; annual_goal_id: string | null; sfa_id: string | null }>),
    roster(db, company.id),
  ]);
  const [goals, areas] = await Promise.all([
    titles(db, "annual_goals", uniq(rows.map((r) => r.annual_goal_id))),
    titles(db, "strategic_focus_areas", uniq(rows.map((r) => r.sfa_id))),
  ]);
  return {
    company: company.name,
    quarter: { label: quarter.label, starts: quarter.start_date, ends: quarter.end_date, open: quarter.status === "open" },
    quarters_available: quarters.map((q) => q.label),
    priorities: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      owner: r.owner_id ? names.get(r.owner_id) ?? null : null,
      due_date: r.due_date,
      status: r.status,
      annual_goal: r.annual_goal_id ? goals.get(r.annual_goal_id) ?? null : null,
      focus_area: r.sfa_id ? areas.get(r.sfa_id) ?? null : null,
    })),
  };
}

export async function annualGoals({ db, company }: Ctx) {
  const [rows, names] = await Promise.all([
    db
      .from("annual_goals")
      .select("id, title, description, owner_id, target_date, status, sfa_id")
      .eq("company_id", company.id)
      .eq("archived", false)
      .order("sort_order")
      .then((res) => must(res) as Array<{ id: string; title: string; description: string | null; owner_id: string | null; target_date: string | null; status: string; sfa_id: string | null }>),
    roster(db, company.id),
  ]);
  const areas = await titles(db, "strategic_focus_areas", uniq(rows.map((r) => r.sfa_id)));
  return {
    company: company.name,
    goals: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      owner: r.owner_id ? names.get(r.owner_id) ?? null : null,
      target_date: r.target_date,
      status: r.status,
      focus_area: r.sfa_id ? areas.get(r.sfa_id) ?? null : null,
    })),
  };
}

// The company's foundation and strategic plan: purpose, vision, core
// values and strategic focus areas. Not differentiators, key success
// metrics or the marketing strategy, which AiMS also holds.
export async function companyPlan({ db, company }: Ctx) {
  const [foundation, values, areas, names] = await Promise.all([
    db
      .from("company_foundation")
      .select("purpose_statement, purpose_context, vision")
      .eq("company_id", company.id)
      .limit(1)
      .then((res) => (must(res) as Array<{ purpose_statement: string | null; purpose_context: string | null; vision: string | null }>)[0] ?? null),
    db
      .from("foundation_items")
      .select("title, body")
      .eq("company_id", company.id)
      .eq("kind", "core_value")
      .order("sort_order")
      .then((res) => must(res) as Array<{ title: string; body: string | null }>),
    db
      .from("strategic_focus_areas")
      .select("title, description, sponsor_id, status")
      .eq("company_id", company.id)
      .eq("archived", false)
      .order("sort_order")
      .order("created_at")
      .then((res) => must(res) as Array<{ title: string; description: string | null; sponsor_id: string | null; status: string }>),
    roster(db, company.id),
  ]);
  return {
    company: company.name,
    purpose: foundation?.purpose_statement ?? null,
    purpose_context: foundation?.purpose_context ?? null,
    vision: foundation?.vision ?? null,
    core_values: values.map((v) => ({ value: v.title, meaning: v.body })),
    focus_areas: areas.map((a) => ({
      title: a.title,
      description: a.description,
      sponsor: a.sponsor_id ? names.get(a.sponsor_id) ?? null : null,
      status: a.status,
    })),
  };
}
