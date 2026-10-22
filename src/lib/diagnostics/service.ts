import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import {
  CLIENT_COLUMNS,
  DIAGNOSTIC_COLUMNS,
  PARTICIPANT_COLUMNS,
  TASK_COLUMNS,
  WIN_COLUMNS,
  type AnswerRow,
  type ClientRow,
  type DiagnosticBundle,
  type DiagnosticRow,
  type NoteRow,
  type ParticipantRow,
  type QuoteRow,
  type TaskRow,
  type WinRow,
} from "./types";

// Every read goes through the caller's own client, so row security
// (system admin only, 0294) is the boundary; the pages' requireRole is
// courtesy.

async function db() {
  return createSupabaseServerClient(getCurrentInstanceConfig());
}

export type ClientListRow = ClientRow & {
  diagnostics: number;
  latest: { status: DiagnosticRow["status"]; decision: DiagnosticRow["decision"] } | null;
};

export async function listClients(): Promise<ClientListRow[]> {
  const supabase = await db();
  const [{ data: clients }, { data: dx }] = await Promise.all([
    supabase.from("diagnostic_clients").select(CLIENT_COLUMNS).order("created_at", { ascending: false }).limit(500),
    supabase
      .from("diagnostics")
      .select("client_id, status, decision, created_at")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);
  const byClient = new Map<string, Array<Pick<DiagnosticRow, "status" | "decision">>>();
  for (const d of (dx ?? []) as Array<Pick<DiagnosticRow, "client_id" | "status" | "decision">>) {
    byClient.set(d.client_id, [...(byClient.get(d.client_id) ?? []), d]);
  }
  return ((clients ?? []) as ClientRow[]).map((c) => {
    const list = byClient.get(c.id) ?? [];
    return { ...c, diagnostics: list.length, latest: list[0] ?? null };
  });
}

export async function getClient(id: string): Promise<{ client: ClientRow; diagnostics: DiagnosticRow[] } | null> {
  const supabase = await db();
  const [{ data: client }, { data: dx }] = await Promise.all([
    supabase.from("diagnostic_clients").select(CLIENT_COLUMNS).eq("id", id).maybeSingle<ClientRow>(),
    supabase.from("diagnostics").select(DIAGNOSTIC_COLUMNS).eq("client_id", id).order("created_at", { ascending: false }),
  ]);
  if (!client) return null;
  return { client, diagnostics: (dx ?? []) as DiagnosticRow[] };
}

export type DiagnosticListRow = DiagnosticRow & {
  client_name: string;
  participants: number;
  surveys: number;
  first_win_measured: boolean;
};

export async function listDiagnostics(): Promise<DiagnosticListRow[]> {
  const supabase = await db();
  const [{ data: dx }, { data: clients }, { data: people }, { data: wins }] = await Promise.all([
    supabase.from("diagnostics").select(DIAGNOSTIC_COLUMNS).is("archived_at", null).order("created_at", { ascending: false }).limit(500),
    supabase.from("diagnostic_clients").select("id, name").limit(1000),
    supabase.from("diagnostic_participants").select("diagnostic_id, survey_entered_at").limit(10000),
    supabase.from("diagnostic_wins").select("diagnostic_id, measured_week_ending").eq("is_first_win", true).limit(2000),
  ]);
  const names = new Map(((clients ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const counts = new Map<string, { n: number; s: number }>();
  for (const p of (people ?? []) as Array<{ diagnostic_id: string; survey_entered_at: string | null }>) {
    const c = counts.get(p.diagnostic_id) ?? { n: 0, s: 0 };
    c.n += 1;
    if (p.survey_entered_at) c.s += 1;
    counts.set(p.diagnostic_id, c);
  }
  const measured = new Set(
    ((wins ?? []) as Array<{ diagnostic_id: string; measured_week_ending: string | null }>)
      .filter((w) => w.measured_week_ending)
      .map((w) => w.diagnostic_id)
  );
  return ((dx ?? []) as DiagnosticRow[]).map((d) => ({
    ...d,
    client_name: names.get(d.client_id) ?? "Unknown client",
    participants: counts.get(d.id)?.n ?? 0,
    surveys: counts.get(d.id)?.s ?? 0,
    first_win_measured: measured.has(d.id),
  }));
}

export async function getDiagnostic(id: string): Promise<DiagnosticBundle | null> {
  const supabase = await db();
  const { data: diagnostic } = await supabase.from("diagnostics").select(DIAGNOSTIC_COLUMNS).eq("id", id).maybeSingle<DiagnosticRow>();
  if (!diagnostic) return null;
  const [client, participants, tasks, quotes, wins] = await Promise.all([
    supabase.from("diagnostic_clients").select(CLIENT_COLUMNS).eq("id", diagnostic.client_id).maybeSingle<ClientRow>(),
    supabase.from("diagnostic_participants").select(PARTICIPANT_COLUMNS).eq("diagnostic_id", id).order("created_at"),
    supabase.from("diagnostic_tasks").select(TASK_COLUMNS).eq("diagnostic_id", id).order("created_at"),
    supabase
      .from("diagnostic_quotes")
      .select("id, participant_id, text, approved_at, created_at")
      .eq("diagnostic_id", id)
      .order("created_at"),
    supabase.from("diagnostic_wins").select(WIN_COLUMNS).eq("diagnostic_id", id).eq("is_first_win", true).limit(1),
  ]);
  if (!client.data) return null;
  const people = (participants.data ?? []) as ParticipantRow[];
  const ids = people.map((p) => p.id);
  const [answers, notes] = ids.length
    ? await Promise.all([
        supabase.from("diagnostic_answers").select("participant_id, best_work, task_to_lose, trust_needs").in("participant_id", ids),
        supabase.from("diagnostic_notes").select("participant_id, body, peak_experience, redeploy_wish").in("participant_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  return {
    diagnostic,
    client: client.data,
    participants: people,
    tasks: (tasks.data ?? []) as TaskRow[],
    answers: (answers.data ?? []) as AnswerRow[],
    notes: (notes.data ?? []) as NoteRow[],
    quotes: (quotes.data ?? []) as QuoteRow[],
    firstWin: ((wins.data ?? []) as WinRow[])[0] ?? null,
  };
}
