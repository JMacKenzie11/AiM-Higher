"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { MAX_TASKS_PER_PARTICIPANT, type DataRisk } from "./hours-back";
import { winPattern } from "./win-patterns";
import { isStep, statusAfterVisiting, type DiagnosticStep } from "./steps";
import { CLIENT_SOURCES, READOUT_SECTIONS, type DiagnosticStatus, type Narrative, type ReadoutSection, type RoadmapItem } from "./types";
import { rollUpTitles } from "./titles";
import { parseParticipantLines } from "./participants";
import { getDiagnostic, readoutToday } from "./service";
import { assembleReadout, publishBlocker } from "./readout";
import { writeNarrative } from "./narrative-call";
import { suggestQuoteLines } from "./quote-call";

// The Capacity Diagnostic's writes. Allowed roles: system_admin, on
// every action (requireRole as courtesy; row security in 0294 is the
// boundary). Every write goes through the caller's own client, and
// checks rows affected rather than `error`, since a write that row
// security refuses on update matches nothing and returns no error.

export type DxResult = { ok: true; id?: string } | { ok: false; message: string };

const REFUSED: DxResult = { ok: false, message: "That didn't save. Reload the page and try again." };
// 0296's freeze raises 42501 on any change to a published diagnostic
// beyond its decision.
const PUBLISHED: DxResult = { ok: false, message: "This readout is published, so it can't change." };
const refusedOr = (error: { code?: string } | null): DxResult => (error?.code === "42501" ? PUBLISHED : REFUSED);

async function caller() {
  await requireRole(["system_admin"]);
  return createSupabaseServerClient(getCurrentInstanceConfig());
}

function touched(diagnosticId?: string, clientId?: string) {
  revalidatePath("/diagnostics");
  revalidatePath("/diagnostics/clients");
  if (clientId) revalidatePath(`/diagnostics/clients/${clientId}`);
  if (diagnosticId) revalidatePath(`/diagnostics/${diagnosticId}`);
}

// ---- Field cleaning ------------------------------------------------

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function numberIn(v: unknown, lo: number, hi: number): number | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < lo || n > hi) return "bad";
  return Math.round(n * 10) / 10;
}

function rating(v: unknown): number | "bad" {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : "bad";
}

function email(v: unknown): string | null | "bad" {
  const t = text(v, 320);
  if (!t) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : "bad";
}

function isoDate(v: unknown): string | null | "bad" {
  const t = text(v, 10);
  if (!t) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) ? t : "bad";
}

// ---- Clients -------------------------------------------------------

export type ClientInput = {
  name: string;
  owner_name?: string;
  owner_email?: string;
  industry?: string;
  employee_count?: string | number | null;
  city?: string;
  country?: string;
  source?: string;
  notes?: string;
};

function cleanClient(input: ClientInput): Record<string, unknown> | string {
  const name = text(input.name, 200);
  if (!name) return "Add the client's name.";
  const ownerEmail = email(input.owner_email);
  if (ownerEmail === "bad") return "That owner email doesn't look right.";
  const size = numberIn(input.employee_count, 1, 100000);
  if (size === "bad") return "Employees should be a whole number.";
  const country = input.country === "CA" || input.country === "US" ? input.country : null;
  const source = CLIENT_SOURCES.some((s) => s.value === input.source) ? input.source : null;
  return {
    name,
    owner_name: text(input.owner_name, 200),
    owner_email: ownerEmail,
    industry: text(input.industry, 200),
    employee_count: size == null ? null : Math.round(size),
    city: text(input.city, 200),
    country,
    source,
    notes: text(input.notes, 8000),
  };
}

export async function saveClientAction(id: string | null, input: ClientInput): Promise<DxResult> {
  const supabase = await caller();
  const row = cleanClient(input);
  if (typeof row === "string") return { ok: false, message: row };
  const q = id
    ? supabase.from("diagnostic_clients").update(row).eq("id", id).select("id")
    : supabase.from("diagnostic_clients").insert(row).select("id");
  const { data, error } = await q;
  if (error || !data?.length) return REFUSED;
  touched(undefined, data[0].id);
  return { ok: true, id: data[0].id };
}

export async function setClientArchivedAction(id: string, archived: boolean): Promise<DxResult> {
  const supabase = await caller();
  const { data } = await supabase
    .from("diagnostic_clients")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (!data?.length) return REFUSED;
  touched(undefined, id);
  return { ok: true };
}

// ---- Diagnostics ---------------------------------------------------

export async function startDiagnosticAction(clientId: string): Promise<DxResult> {
  const supabase = await caller();
  const { data } = await supabase.from("diagnostics").insert({ client_id: clientId }).select("id");
  if (!data?.length) return REFUSED;
  touched(data[0].id, clientId);
  return { ok: true, id: data[0].id };
}

export async function setDiagnosticArchivedAction(id: string, archived: boolean): Promise<DxResult> {
  const supabase = await caller();
  const { data } = await supabase
    .from("diagnostics")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id, client_id");
  if (!data?.length) return REFUSED;
  touched(id, data[0].client_id);
  return { ok: true };
}

// The fields a step edits. Anything else in the patch is ignored.
export type DiagnosticPatch = {
  tools_in_use?: string;
  it_contact?: string;
  access_secured?: boolean;
  brief_sent?: boolean;
  conversations_booked?: boolean;
  scope?: string;
  capacity_destination?: string;
  pledge_text?: string;
  pledge_sent?: boolean;
  kickoff_at?: string;
  readout_at?: string;
  midpoint_at?: string;
  midpoint_note?: string;
  guarantee_hours?: string | number;
  data_at_risk?: string;
  guardrail_rules?: string;
};

export async function updateDiagnosticAction(id: string, patch: DiagnosticPatch): Promise<DxResult> {
  const supabase = await caller();
  const row: Record<string, unknown> = {};
  const limits: Array<[keyof DiagnosticPatch, number]> = [
    ["tools_in_use", 4000],
    ["it_contact", 500],
    ["scope", 2000],
    ["capacity_destination", 2000],
    ["pledge_text", 4000],
    ["midpoint_note", 4000],
    ["data_at_risk", 2000],
    ["guardrail_rules", 2000],
  ];
  for (const [k, max] of limits) if (k in patch) row[k] = text(patch[k], max);
  for (const k of ["access_secured", "brief_sent", "conversations_booked"] as const) {
    if (k in patch) row[k] = patch[k] === true;
  }
  if ("pledge_sent" in patch) row.pledge_sent_at = patch.pledge_sent ? new Date().toISOString() : null;
  for (const k of ["kickoff_at", "readout_at", "midpoint_at"] as const) {
    if (k in patch) {
      const d = isoDate(patch[k]);
      if (d === "bad") return { ok: false, message: "That date doesn't look right." };
      row[k] = d;
    }
  }
  if ("guarantee_hours" in patch) {
    const g = numberIn(patch.guarantee_hours, 0.5, 40);
    if (g === "bad" || g == null) return { ok: false, message: "The guarantee should be a number of hours." };
    row.guarantee_hours = g;
  }
  if (Object.keys(row).length === 0) return { ok: true };
  const { data, error } = await supabase.from("diagnostics").update(row).eq("id", id).select("id");
  if (!data?.length) return refusedOr(error);
  touched(id);
  return { ok: true };
}

// Moving to a step moves the status forward with it, never back. The
// pre-flight's rule holds here too: nothing past it until access is
// secured.
export async function visitStepAction(id: string, step: DiagnosticStep): Promise<DxResult> {
  const supabase = await caller();
  if (!isStep(step)) return { ok: false, message: "That step doesn't exist." };
  const { data: d } = await supabase
    .from("diagnostics")
    .select("status, access_secured")
    .eq("id", id)
    .maybeSingle<{ status: DiagnosticStatus; access_secured: boolean }>();
  if (!d) return REFUSED;
  if (step !== "preflight" && !d.access_secured) {
    return { ok: false, message: "Tick access secured first. No access by kickoff means the kickoff moves." };
  }
  const status = statusAfterVisiting(d.status, step);
  if (status !== d.status) {
    const { data } = await supabase.from("diagnostics").update({ status }).eq("id", id).select("id");
    if (!data?.length) return REFUSED;
    touched(id);
  }
  return { ok: true };
}

// ---- Participants --------------------------------------------------

export async function addParticipantsAction(diagnosticId: string, raw: string): Promise<DxResult> {
  const supabase = await caller();
  const people = parseParticipantLines(raw);
  if (people.length === 0) return { ok: false, message: "Add at least one name." };
  if (people.length > 40) return { ok: false, message: "That's more than 40 people. A diagnostic covers one or two departments." };
  const { data } = await supabase
    .from("diagnostic_participants")
    .insert(people.map((p) => ({ ...p, diagnostic_id: diagnosticId })))
    .select("id");
  if (!data?.length) return REFUSED;
  touched(diagnosticId);
  return { ok: true };
}

export type ParticipantPatch = { in_conversations?: boolean };

export async function updateParticipantAction(id: string, patch: ParticipantPatch): Promise<DxResult> {
  const supabase = await caller();
  const row: Record<string, unknown> = {};
  if ("in_conversations" in patch) {
    row.in_conversations = patch.in_conversations === true;
    row.conversation_at = patch.in_conversations ? new Date().toISOString() : null;
  }
  const { data } = await supabase.from("diagnostic_participants").update(row).eq("id", id).select("id, diagnostic_id");
  if (!data?.length) return REFUSED;
  touched(data[0].diagnostic_id);
  return { ok: true };
}

// ---- The survey ----------------------------------------------------

export type SurveyTaskInput = { id?: string; title: string; hours_per_week: string | number; energy: string | number; judgment: string | number };

export type SurveyInput = {
  name: string;
  role_title?: string;
  email?: string;
  years_with_company?: string | number | null;
  tasks: SurveyTaskInput[];
  best_work?: string;
  task_to_lose?: string;
  trust_needs?: string;
};

// One participant's survey, as the assessor enters it: who they are,
// up to ten tasks, three open answers. Tasks the form no longer lists
// are removed; the rest are updated in place, so volume checks and
// canonical titles entered on the combined grid survive a re-save.
export async function saveSurveyAction(participantId: string, input: SurveyInput): Promise<DxResult> {
  const supabase = await caller();
  const name = text(input.name, 200);
  if (!name) return { ok: false, message: "Add the person's name." };
  const mail = email(input.email);
  if (mail === "bad") return { ok: false, message: "That email doesn't look right." };
  const years = numberIn(input.years_with_company, 0, 80);
  if (years === "bad") return { ok: false, message: "Years with the company should be a number." };

  const rows = input.tasks.filter((t) => text(t.title, 300));
  if (rows.length > MAX_TASKS_PER_PARTICIPANT) return { ok: false, message: `Up to ${MAX_TASKS_PER_PARTICIPANT} tasks per person.` };
  const tasks: Array<{ id?: string; title: string; hours_per_week: number; energy: number; judgment: number }> = [];
  for (const t of rows) {
    const hours = numberIn(t.hours_per_week, 0, 80);
    const energy = rating(t.energy);
    const judgment = rating(t.judgment);
    if (hours === "bad" || hours == null) return { ok: false, message: `Add hours a week for "${t.title.trim()}".` };
    if (energy === "bad" || judgment === "bad") return { ok: false, message: `Rate energy and judgment from 1 to 5 for "${t.title.trim()}".` };
    tasks.push({ id: t.id, title: text(t.title, 300)!, hours_per_week: hours, energy, judgment });
  }

  const { data: person } = await supabase
    .from("diagnostic_participants")
    .update({ name, role_title: text(input.role_title, 200), email: mail, years_with_company: years, survey_entered_at: new Date().toISOString() })
    .eq("id", participantId)
    .select("id, diagnostic_id");
  if (!person?.length) return REFUSED;
  const diagnosticId = person[0].diagnostic_id as string;

  const { data: existing } = await supabase.from("diagnostic_tasks").select("id").eq("participant_id", participantId);
  const keep = new Set(tasks.map((t) => t.id).filter(Boolean));
  const gone = ((existing ?? []) as Array<{ id: string }>).map((r) => r.id).filter((id) => !keep.has(id));
  if (gone.length) {
    const { data } = await supabase.from("diagnostic_tasks").delete().in("id", gone).select("id");
    if ((data?.length ?? 0) !== gone.length) return REFUSED;
  }
  for (const t of tasks) {
    const fields = { title: t.title, hours_per_week: t.hours_per_week, energy: t.energy, judgment: t.judgment };
    const { data } = t.id
      ? await supabase.from("diagnostic_tasks").update(fields).eq("id", t.id).eq("participant_id", participantId).select("id")
      : await supabase
          .from("diagnostic_tasks")
          .insert({ ...fields, diagnostic_id: diagnosticId, participant_id: participantId, source: "survey" })
          .select("id");
    if (!data?.length) return REFUSED;
  }

  const answers = {
    participant_id: participantId,
    best_work: text(input.best_work, 4000),
    task_to_lose: text(input.task_to_lose, 4000),
    trust_needs: text(input.trust_needs, 4000),
  };
  const { data: a } = await supabase.from("diagnostic_answers").upsert(answers, { onConflict: "participant_id" }).select("participant_id");
  if (!a?.length) return REFUSED;

  touched(diagnosticId);
  return { ok: true };
}

// ---- The combined task grid ---------------------------------------

export type TaskPatch = {
  title?: string;
  canonical_title?: string;
  hours_per_week?: string | number;
  energy?: string | number;
  judgment?: string | number;
  volume_units_per_week?: string | number | null;
  minutes_per_unit?: string | number | null;
  data_risk?: string | null;
  build_effort_hours?: string | number | null;
  candidate_override?: "auto" | "yes" | "no";
};

function cleanTaskPatch(patch: TaskPatch): Record<string, unknown> | string {
  const row: Record<string, unknown> = {};
  if ("title" in patch) {
    const t = text(patch.title, 300);
    if (!t) return "A task needs a title.";
    row.title = t;
  }
  if ("canonical_title" in patch) row.canonical_title = text(patch.canonical_title, 300);
  if ("hours_per_week" in patch) {
    const h = numberIn(patch.hours_per_week, 0, 80);
    if (h === "bad" || h == null) return "Hours a week should be a number from 0 to 80.";
    row.hours_per_week = h;
  }
  for (const k of ["energy", "judgment"] as const) {
    if (k in patch) {
      const r = rating(patch[k]);
      if (r === "bad") return "Ratings run from 1 to 5.";
      row[k] = r;
    }
  }
  const nums: Array<[keyof TaskPatch, number]> = [
    ["volume_units_per_week", 100000],
    ["minutes_per_unit", 10000],
    ["build_effort_hours", 1000],
  ];
  for (const [k, hi] of nums) {
    if (k in patch) {
      const n = numberIn(patch[k], 0, hi);
      if (n === "bad") return "That should be a number.";
      row[k] = n;
    }
  }
  if ("data_risk" in patch) {
    const r = patch.data_risk;
    row.data_risk = r === "low" || r === "medium" || r === "high" ? (r as DataRisk) : null;
  }
  if ("candidate_override" in patch) {
    row.candidate_override = patch.candidate_override === "yes" ? true : patch.candidate_override === "no" ? false : null;
  }
  return row;
}

export async function updateTaskAction(id: string, patch: TaskPatch): Promise<DxResult> {
  const supabase = await caller();
  const row = cleanTaskPatch(patch);
  if (typeof row === "string") return { ok: false, message: row };
  if (Object.keys(row).length === 0) return { ok: true };
  const { data } = await supabase.from("diagnostic_tasks").update(row).eq("id", id).select("id, diagnostic_id");
  if (!data?.length) return REFUSED;
  touched(data[0].diagnostic_id);
  return { ok: true };
}

// A task the lead adds on the grid (source "lead"), for a person in scope.
export async function addTaskAction(
  diagnosticId: string,
  participantId: string,
  input: { title: string; hours_per_week: string | number; energy: string | number; judgment: string | number }
): Promise<DxResult> {
  const supabase = await caller();
  const row = cleanTaskPatch(input);
  if (typeof row === "string") return { ok: false, message: row };
  if (!row.title || row.hours_per_week == null || row.energy == null || row.judgment == null) {
    return { ok: false, message: "Add a title, hours, energy and judgment." };
  }
  const { count } = await supabase
    .from("diagnostic_tasks")
    .select("id", { count: "exact", head: true })
    .eq("participant_id", participantId);
  if ((count ?? 0) >= MAX_TASKS_PER_PARTICIPANT) return { ok: false, message: `That person already has ${MAX_TASKS_PER_PARTICIPANT} tasks.` };
  const { data } = await supabase
    .from("diagnostic_tasks")
    .insert({ ...row, diagnostic_id: diagnosticId, participant_id: participantId, source: "lead" })
    .select("id");
  if (!data?.length) return REFUSED;
  touched(diagnosticId);
  return { ok: true };
}

export async function deleteTaskAction(id: string): Promise<DxResult> {
  const supabase = await caller();
  const { data: win } = await supabase.from("diagnostic_wins").select("id").eq("task_id", id).limit(1);
  if (win?.length) return { ok: false, message: "That task has the first win on it. Choose a different task for the win first." };
  const { data } = await supabase.from("diagnostic_tasks").delete().eq("id", id).select("id, diagnostic_id");
  if (!data?.length) return REFUSED;
  touched(data[0].diagnostic_id);
  return { ok: true };
}

export async function rollUpTitlesAction(diagnosticId: string): Promise<DxResult> {
  const supabase = await caller();
  const result = await rollUpTitles(supabase, diagnosticId);
  touched(diagnosticId);
  if (result === "failed") return { ok: false, message: "The titles couldn't be rolled up just now. Try again, or type them in." };
  return { ok: true };
}

// ---- Conversations -------------------------------------------------

export type NotesInput = { body?: string; peak_experience?: string; redeploy_wish?: string; destination_hours?: string };

export async function saveNotesAction(diagnosticId: string, participantId: string, input: NotesInput): Promise<DxResult> {
  const supabase = await caller();
  const row: Record<string, unknown> = { diagnostic_id: diagnosticId, participant_id: participantId };
  if ("body" in input) row.body = (input.body ?? "").slice(0, 8000);
  if ("peak_experience" in input) row.peak_experience = text(input.peak_experience, 2000);
  if ("redeploy_wish" in input) row.redeploy_wish = text(input.redeploy_wish, 2000);
  if ("destination_hours" in input) {
    const h = numberIn(input.destination_hours, 0, 40);
    if (h === "bad") return { ok: false, message: "Hours toward the destination should be between 0 and 40." };
    row.destination_hours = h;
  }
  const { data } = await supabase.from("diagnostic_notes").upsert(row, { onConflict: "participant_id" }).select("participant_id");
  if (!data?.length) return { ok: false, message: "Those notes didn't save. A published diagnostic's notes can't change." };
  touched(diagnosticId);
  return { ok: true };
}

// A line pulled from the notes, unapproved and without a name until
// the lead decides otherwise.
export async function addQuoteAction(diagnosticId: string, quote: string): Promise<DxResult> {
  const supabase = await caller();
  const t = text(quote, 1000);
  if (!t) return { ok: false, message: "Select the words in the notes first." };
  const { data } = await supabase.from("diagnostic_quotes").insert({ diagnostic_id: diagnosticId, text: t }).select("id");
  if (!data?.length) return REFUSED;
  touched(diagnosticId);
  return { ok: true };
}

export async function updateQuoteAction(
  id: string,
  patch: { approved?: boolean; participant_id?: string | null; text?: string }
): Promise<DxResult> {
  const supabase = await caller();
  const row: Record<string, unknown> = {};
  if ("approved" in patch) row.approved_at = patch.approved ? new Date().toISOString() : null;
  if ("participant_id" in patch) row.participant_id = patch.participant_id || null;
  if ("text" in patch) {
    const t = text(patch.text, 1000);
    if (!t) return { ok: false, message: "A quote needs words." };
    row.text = t;
  }
  const { data } = await supabase.from("diagnostic_quotes").update(row).eq("id", id).select("id, diagnostic_id");
  if (!data?.length) return REFUSED;
  touched(data[0].diagnostic_id);
  return { ok: true };
}

export async function deleteQuoteAction(id: string): Promise<DxResult> {
  const supabase = await caller();
  const { data } = await supabase.from("diagnostic_quotes").delete().eq("id", id).select("id, diagnostic_id");
  if (!data?.length) return { ok: false, message: "Only a line not yet approved can be discarded." };
  touched(data[0].diagnostic_id);
  return { ok: true };
}

// ---- The first win -------------------------------------------------

export type WinInput = {
  task_id: string;
  pattern: string;
  title: string;
  built_at?: string;
  in_use_from?: string;
  baseline_minutes_per_unit?: string | number | null;
  after_minutes_per_unit?: string | number | null;
  units_per_week?: string | number | null;
  measured_week_ending?: string;
};

export async function saveFirstWinAction(diagnosticId: string, input: WinInput): Promise<DxResult> {
  const supabase = await caller();
  const pattern = winPattern(input.pattern);
  if (!pattern) return { ok: false, message: "Choose a pattern from the library." };
  const title = text(input.title, 300) ?? pattern.title;
  const dates: Record<string, string | null> = {};
  for (const k of ["built_at", "in_use_from", "measured_week_ending"] as const) {
    const d = isoDate(input[k]);
    if (d === "bad") return { ok: false, message: "That date doesn't look right." };
    dates[k] = d;
  }
  if (dates.measured_week_ending && new Date(`${dates.measured_week_ending}T00:00:00Z`).getUTCDay() !== 5) {
    return { ok: false, message: "The measured week ends on a Friday." };
  }
  const nums: Record<string, number | null> = {};
  for (const [k, hi] of [["baseline_minutes_per_unit", 10000], ["after_minutes_per_unit", 10000], ["units_per_week", 100000]] as const) {
    const n = numberIn(input[k], 0, hi);
    if (n === "bad") return { ok: false, message: "Minutes and units should be numbers." };
    nums[k] = n;
  }
  const { data: task } = await supabase.from("diagnostic_tasks").select("id").eq("id", input.task_id).eq("diagnostic_id", diagnosticId).maybeSingle();
  if (!task) return { ok: false, message: "Choose the task the win serves." };
  const row = { diagnostic_id: diagnosticId, task_id: input.task_id, pattern: pattern.slug, title, ...dates, ...nums, is_first_win: true };
  const { data: existing } = await supabase.from("diagnostic_wins").select("id").eq("diagnostic_id", diagnosticId).eq("is_first_win", true).limit(1);
  const id = (existing as Array<{ id: string }> | null)?.[0]?.id;
  const { data } = id
    ? await supabase.from("diagnostic_wins").update(row).eq("id", id).select("id")
    : await supabase.from("diagnostic_wins").insert(row).select("id");
  if (!data?.length) return REFUSED;
  touched(diagnosticId);
  return { ok: true };
}

// ---- The readout (phase 2) -----------------------------------------

// Lines the quote call proposes from one person's notes, added as
// unapproved quotes with no name.
export async function suggestQuotesAction(diagnosticId: string, participantId: string): Promise<DxResult & { added?: number }> {
  const supabase = await caller();
  const [{ data: note }, { data: existing }] = await Promise.all([
    supabase
      .from("diagnostic_notes")
      .select("body, peak_experience, redeploy_wish")
      .eq("participant_id", participantId)
      .eq("diagnostic_id", diagnosticId)
      .maybeSingle<{ body: string; peak_experience: string | null; redeploy_wish: string | null }>(),
    supabase.from("diagnostic_quotes").select("text").eq("diagnostic_id", diagnosticId).limit(200),
  ]);
  const notes = [note?.body, note?.peak_experience, note?.redeploy_wish].filter(Boolean).join("\n\n");
  if (notes.trim().length < 40) return { ok: false, message: "Write the notes for this conversation first." };
  const result = await suggestQuoteLines(notes, (existing ?? []).map((q: { text: string }) => q.text));
  if (!result.ok) return result;
  if (result.lines.length === 0) return { ok: false, message: "No lines in these notes stood out. Pull one by hand if you have one in mind." };
  const { data } = await supabase
    .from("diagnostic_quotes")
    .insert(result.lines.map((t) => ({ diagnostic_id: diagnosticId, text: t })))
    .select("id");
  if (!data?.length) return REFUSED;
  touched(diagnosticId);
  return { ok: true, added: data.length };
}

export async function saveRoadmapAction(id: string, items: RoadmapItem[]): Promise<DxResult> {
  const supabase = await caller();
  if (!Array.isArray(items) || items.length > 3) return { ok: false, message: "The roadmap holds three next wins." };
  const roadmap: RoadmapItem[] = [];
  for (const item of items) {
    const title = text(item?.title, 200);
    if (!title) continue;
    const week = numberIn(item?.target_week, 1, 13);
    if (week === "bad" || (week != null && !Number.isInteger(week))) {
      return { ok: false, message: "A target week is a whole number from 1 to 13." };
    }
    roadmap.push({ title, target_week: week, champion: text(item?.champion, 200) ?? "" });
  }
  const { data, error } = await supabase.from("diagnostics").update({ roadmap }).eq("id", id).select("id");
  if (!data?.length) return refusedOr(error);
  touched(id);
  return { ok: true };
}

// The readout writer, over the readout as it stands. Replaces the
// narrative; the lead edits it after.
export async function generateNarrativeAction(id: string): Promise<DxResult & { dropped?: number }> {
  const supabase = await caller();
  const bundle = await getDiagnostic(id);
  if (!bundle) return REFUSED;
  if (bundle.diagnostic.published_at) return PUBLISHED;
  const result = await writeNarrative(assembleReadout(bundle, readoutToday()), bundle.diagnostic.pledge_text);
  if (!result.ok) return result;
  const { data, error } = await supabase.from("diagnostics").update({ narrative: result.narrative }).eq("id", id).select("id");
  if (!data?.length) return refusedOr(error);
  touched(id);
  return { ok: true, dropped: result.dropped.length };
}

export async function saveNarrativeSectionAction(id: string, section: ReadoutSection, value: string): Promise<DxResult> {
  const supabase = await caller();
  if (!READOUT_SECTIONS.some((s) => s.key === section)) return REFUSED;
  const { data: d } = await supabase.from("diagnostics").select("narrative").eq("id", id).maybeSingle<{ narrative: Narrative | null }>();
  if (!d) return REFUSED;
  const narrative: Narrative = { ...(d.narrative ?? {}) };
  const t = text(value, 1500);
  if (t) narrative[section] = t;
  else delete narrative[section];
  const { data, error } = await supabase.from("diagnostics").update({ narrative }).eq("id", id).select("id");
  if (!data?.length) return refusedOr(error);
  touched(id);
  return { ok: true };
}

// Publish: the readout as it stands becomes the one the owner gets.
// published_at and published_readout are written together and never
// change again (0296); the PDF renders from published_readout.
export async function publishReadoutAction(id: string): Promise<DxResult> {
  const supabase = await caller();
  const bundle = await getDiagnostic(id);
  if (!bundle) return REFUSED;
  if (bundle.diagnostic.published_at) return PUBLISHED;
  const readout = assembleReadout(bundle, readoutToday());
  const blocker = publishBlocker(readout);
  if (blocker) return { ok: false, message: blocker };
  const status = statusAfterVisiting(bundle.diagnostic.status, "readout");
  const { data, error } = await supabase
    .from("diagnostics")
    .update({ published_at: new Date().toISOString(), published_readout: readout, status })
    .eq("id", id)
    .is("published_at", null)
    .select("id");
  if (!data?.length) return refusedOr(error);
  touched(id);
  return { ok: true };
}

// Record decision sets the decision and nothing else on the platform:
// a sprint that starts is set up by hand, where it belongs.
export async function recordDecisionAction(id: string, decision: "sprint" | "declined" | "pending"): Promise<DxResult> {
  const supabase = await caller();
  if (!["sprint", "declined", "pending"].includes(decision)) return REFUSED;
  const decided = decision !== "pending";
  const { data, error } = await supabase
    .from("diagnostics")
    .update({ decision, decided_at: decided ? new Date().toISOString() : null, status: decided ? "decided" : "readout" })
    .eq("id", id)
    .select("id, client_id");
  if (!data?.length) return refusedOr(error);
  touched(id, data[0].client_id);
  return { ok: true };
}
