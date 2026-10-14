import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { thisFriday, mondayOf } from "@/lib/dates";
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
    await db.from("companies").select("id, name").is("deleted_at", null).order("name")
  ) as Array<{ id: string; name: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name }));
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
  "id, owner_id, description, due_date, due_date_defaulted, status, is_ongoing, parked_at, completed_at, priority_id, issue_id, functional_area_id";

type CommitmentRow = {
  id: string;
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
  }));
  return { company: company.name, commitments };
}

// ---- measures ----------------------------------------------------------

export async function measures({ db, company }: Ctx, weeksWanted: number) {
  const timezone = await companyTimezone(db, company.id);
  const weekEnding = thisFriday(timezone);
  const window = weeksBack(weekEnding, weeksWanted);
  const [fns, names] = await Promise.all([
    db
      .from("functions")
      .select("id, title, parent_function_id, lead_id, sort_order")
      .eq("company_id", company.id)
      .eq("archived", false)
      .order("sort_order")
      .then((res) => must(res) as Array<{ id: string; title: string; parent_function_id: string | null; lead_id: string | null; sort_order: number }>),
    roster(db, company.id),
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
      ) as Array<{ id: string; function_id: string; description: string; target: string | null; value_type: string; target_direction: string; update_frequency: string | null }>)
    : [];
  const entries = ms.length
    ? (must(
        await db
          .from("success_measure_entries")
          .select("measure_id, week_ending, value_number, value_text")
          .in("measure_id", ms.map((m) => m.id))
          .gte("week_ending", window[0])
          .order("week_ending", { ascending: false })
      ) as Array<{ measure_id: string; week_ending: string; value_number: number | null; value_text: string | null }>)
    : [];

  const functions = ordered
    .map((f) => ({
      function: f.title,
      lead: f.lead_id ? names.get(f.lead_id) ?? null : null,
      measures: ms
        .filter((m) => m.function_id === f.id)
        .map((m) => ({
          id: m.id,
          measure: m.description,
          target: m.target,
          better_when: m.target_direction === "lower_is_better" ? "lower" : "higher",
          value_type: m.value_type,
          frequency: m.update_frequency ?? "weekly",
          recent_values: entries
            .filter((e) => e.measure_id === m.id)
            .map((e) => ({
              week_beginning: mondayOf(e.week_ending),
              value: m.value_type === "text" ? e.value_text : e.value_number,
            })),
        })),
    }))
    .filter((f) => f.measures.length > 0);
  return { company: company.name, this_week_beginning: mondayOf(weekEnding), weeks: weeksWanted, functions };
}

// ---- issues ------------------------------------------------------------

export async function openIssues({ db, company }: Ctx) {
  const [rows, names] = await Promise.all([
    db
      .from("issues")
      .select("id, title, desired_outcome, rank, created_at, created_by")
      .eq("company_id", company.id)
      .eq("status", "open")
      .order("rank")
      .limit(200)
      .then((res) => must(res) as Array<{ id: string; title: string; desired_outcome: string | null; rank: number; created_at: string; created_by: string | null }>),
    roster(db, company.id),
  ]);
  const issues = rows.map((r) => ({
    id: r.id,
    title: r.title,
    desired_outcome: r.desired_outcome,
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
