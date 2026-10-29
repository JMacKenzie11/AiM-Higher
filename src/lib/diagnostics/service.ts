import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import {
  CLIENT_COLUMNS,
  DIAGNOSTIC_COLUMNS,
  PARTICIPANT_COLUMNS,
  TASK_COLUMNS,
  WIN_COLUMNS,
  SYSTEM_COLUMNS,
  SYSTEM_LINK_COLUMNS,
  AI_USE_COLUMNS,
  AUTOMATION_COLUMNS,
  type AutomationRow,
  type AiUseRow,
  type SystemLinkRow,
  type SystemRow,
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
import { assembleReadout, isReadoutData, type ReadoutData } from "./readout";
import type { AcrossInput } from "./across";
import { sortAutomations } from "./automations";
import type { PortalBotData } from "./portal";
import { BOT_COLUMNS, botHealth, botSavings, type BotHealth, type BotRow, type BotRun, type BotSavings } from "./bots";

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

export type ClientBundle = {
  client: ClientRow;
  diagnostics: DiagnosticRow[];
  automations: AutomationRow[];
  // The newest diagnostic, not archived, with a first win or a roadmap
  // to start automations from; null when there is none.
  automationSource: DiagnosticRow | null;
};

export async function getClient(id: string): Promise<ClientBundle | null> {
  const supabase = await db();
  const [{ data: client }, { data: dx }, { data: autos }] = await Promise.all([
    supabase.from("diagnostic_clients").select(CLIENT_COLUMNS).eq("id", id).maybeSingle<ClientRow>(),
    supabase.from("diagnostics").select(DIAGNOSTIC_COLUMNS).eq("client_id", id).order("created_at", { ascending: false }),
    supabase.from("diagnostic_automations").select(AUTOMATION_COLUMNS).eq("client_id", id).limit(500),
  ]);
  if (!client) return null;
  const diagnostics = (dx ?? []) as DiagnosticRow[];
  const live = diagnostics.filter((d) => !d.archived_at);
  const { data: wins } = live.length
    ? await supabase.from("diagnostic_wins").select("diagnostic_id").eq("is_first_win", true).in("diagnostic_id", live.map((d) => d.id))
    : { data: [] };
  const withWin = new Set(((wins ?? []) as Array<{ diagnostic_id: string }>).map((w) => w.diagnostic_id));
  return {
    client,
    diagnostics,
    automations: sortAutomations((autos ?? []) as AutomationRow[]),
    automationSource: live.find((d) => withWin.has(d.id) || d.roadmap.length > 0) ?? null,
  };
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

// The rows the Across clients tab adds up: every diagnostic not
// archived, with its client's industry and source.
export async function listAcrossClients(): Promise<AcrossInput[]> {
  const supabase = await db();
  const [{ data: dx }, { data: clients }] = await Promise.all([
    supabase.from("diagnostics").select("client_id, published_at, published_readout, decision").is("archived_at", null).limit(2000),
    supabase.from("diagnostic_clients").select("id, industry, source").limit(2000),
  ]);
  const byId = new Map(((clients ?? []) as Array<{ id: string; industry: string | null; source: string | null }>).map((c) => [c.id, c]));
  return ((dx ?? []) as Array<{ client_id: string; published_at: string | null; published_readout: unknown; decision: string }>).map((d) => ({
    published_at: d.published_at,
    published_readout: d.published_readout,
    decision: d.decision,
    industry: byId.get(d.client_id)?.industry ?? null,
    source: byId.get(d.client_id)?.source ?? null,
  }));
}

export async function getDiagnostic(id: string): Promise<DiagnosticBundle | null> {
  const supabase = await db();
  const { data: diagnostic } = await supabase.from("diagnostics").select(DIAGNOSTIC_COLUMNS).eq("id", id).maybeSingle<DiagnosticRow>();
  if (!diagnostic) return null;
  const [client, participants, tasks, quotes, wins, systems, links] = await Promise.all([
    supabase.from("diagnostic_clients").select(CLIENT_COLUMNS).eq("id", diagnostic.client_id).maybeSingle<ClientRow>(),
    supabase.from("diagnostic_participants").select(PARTICIPANT_COLUMNS).eq("diagnostic_id", id).order("created_at"),
    supabase.from("diagnostic_tasks").select(TASK_COLUMNS).eq("diagnostic_id", id).order("created_at"),
    supabase
      .from("diagnostic_quotes")
      .select("id, participant_id, text, approved_at, created_at")
      .eq("diagnostic_id", id)
      .order("created_at"),
    supabase.from("diagnostic_wins").select(WIN_COLUMNS).eq("diagnostic_id", id).eq("is_first_win", true).limit(1),
    supabase.from("diagnostic_systems").select(SYSTEM_COLUMNS).eq("diagnostic_id", id).order("created_at"),
    supabase.from("diagnostic_system_links").select(SYSTEM_LINK_COLUMNS).eq("diagnostic_id", id).order("created_at"),
  ]);
  if (!client.data) return null;
  const people = (participants.data ?? []) as ParticipantRow[];
  const ids = people.map((p) => p.id);
  const [answers, notes, aiUse] = ids.length
    ? await Promise.all([
        supabase.from("diagnostic_answers").select("participant_id, best_work, task_to_lose, trust_needs").in("participant_id", ids),
        supabase.from("diagnostic_notes").select("participant_id, body, peak_experience, redeploy_wish, destination_hours").in("participant_id", ids),
        supabase.from("diagnostic_ai_use").select(AI_USE_COLUMNS).in("participant_id", ids).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  return {
    diagnostic,
    client: client.data,
    participants: people,
    tasks: (tasks.data ?? []) as TaskRow[],
    answers: (answers.data ?? []) as AnswerRow[],
    notes: (notes.data ?? []) as NoteRow[],
    quotes: (quotes.data ?? []) as QuoteRow[],
    firstWin: ((wins.data ?? []) as WinRow[])[0] ?? null,
    systems: (systems.data ?? []) as SystemRow[],
    links: (links.data ?? []) as SystemLinkRow[],
    aiUse: (aiUse.data ?? []) as AiUseRow[],
  };
}

// The readout to show: the published copy once there is one, so what
// the owner was given never drifts; until then, the draft from the
// current figures, dated today where the diagnostics are run.
export async function getReadout(id: string): Promise<{ readout: ReadoutData; published: boolean; bundle: DiagnosticBundle } | null> {
  const bundle = await getDiagnostic(id);
  if (!bundle) return null;
  const stored = bundle.diagnostic.published_readout;
  if (isReadoutData(stored)) return { readout: stored, published: true, bundle };
  return { readout: assembleReadout(bundle, readoutToday()), published: false, bundle };
}

export function readoutToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

// ---- Client logins (0307) ------------------------------------------

export type ClientPerson = {
  id: string;
  full_name: string;
  status: "pending" | "active" | "inactive";
  invited_at: string | null;
  // From auth.users, which only the admin client reads: one lookup per
  // person, and a client has a handful (as listSystemAdmins).
  email: string | null;
  last_sign_in_at: string | null;
};

// The people at one client who can sign in to its dashboard. The
// member rows and profiles come through the caller's client (system
// admin only); email and last sign-in through the admin client.
export async function listClientPeople(clientId: string): Promise<ClientPerson[]> {
  const supabase = await db();
  const { data: members } = await supabase.from("diagnostic_client_members").select("profile_id").eq("client_id", clientId).limit(200);
  const ids = ((members ?? []) as Array<{ profile_id: string }>).map((m) => m.profile_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, status, invited_at").in("id", ids).order("full_name");
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  return Promise.all(
    ((profiles ?? []) as Array<Omit<ClientPerson, "email" | "last_sign_in_at">>).map(async (p) => {
      const { data } = await admin.auth.admin.getUserById(p.id);
      return { ...p, email: data?.user?.email ?? null, last_sign_in_at: data?.user?.last_sign_in_at ?? null };
    })
  );
}

// ---- The portal (0307) ---------------------------------------------

export type PortalView = {
  client: { id: string; name: string; country: string | null };
  automations: AutomationRow[];
  // 0310: the bots through portal_dashboard(), as the person.
  bots: PortalBotData[];
  readoutPublishedAt: string | null;
};

// What a diagnostic client's person sees, read as them: their client
// through portal_client() (name and country only) and its automations
// through 0307's read rule. Null when they belong to no live client.
export async function getPortal(): Promise<PortalView | null> {
  const supabase = await db();
  const { data: rows } = await supabase.rpc("portal_client");
  const client = ((rows ?? []) as PortalView["client"][])[0];
  if (!client) return null;
  const [{ data: autos }, { data: dash }] = await Promise.all([
    supabase.from("diagnostic_automations").select(AUTOMATION_COLUMNS).eq("client_id", client.id).limit(500),
    supabase.rpc("portal_dashboard"),
  ]);
  const d = (dash ?? null) as { bots?: PortalBotData[]; readout_published_at?: string | null } | null;
  return {
    client,
    automations: sortAutomations((autos ?? []) as AutomationRow[]),
    bots: d?.bots ?? [],
    readoutPublishedAt: d?.readout_published_at ?? null,
  };
}

// The client's newest published readout, as published, through
// portal_readout() (0310). Null when there is none.
export async function getPortalReadout(): Promise<ReadoutData | null> {
  const supabase = await db();
  const { data } = await supabase.rpc("portal_readout");
  return isReadoutData(data) ? data : null;
}

// ---- Bots (0308) ----------------------------------------------------

export type BotView = {
  bot: BotRow;
  automation: { id: string; title: string; stage: string; goes_live: string | null };
  client: { id: string; name: string };
  health: BotHealth;
  savings: BotSavings;
  // Newest first, the last ten, notes included (system admins only).
  recent: BotRun[];
  lastRunAt: string | null;
};

type BotJoined = BotRow & {
  diagnostic_automations: { id: string; title: string; stage: string; goes_live: string | null } | null;
  diagnostic_clients: { id: string; name: string; archived_at: string | null } | null;
};

// Bots with their health and savings, for one client or every one,
// read as the caller (system admin only, 0308). Every run is read for
// the totals; a client has a handful of bots.
export async function listBots(clientId?: string): Promise<BotView[]> {
  const supabase = await db();
  let q = supabase
    .from("diagnostic_bots")
    .select(`${BOT_COLUMNS}, diagnostic_automations(id, title, stage, goes_live), diagnostic_clients(id, name, archived_at)`)
    .limit(1000);
  if (clientId) q = q.eq("client_id", clientId);
  const { data } = await q;
  const bots = ((data ?? []) as unknown as BotJoined[]).filter(
    (b) => b.diagnostic_automations && b.diagnostic_clients && (clientId || !b.diagnostic_clients.archived_at)
  );
  const now = new Date();
  return Promise.all(
    bots.map(async (b) => {
      const { data: runRows } = await supabase
        .from("diagnostic_bot_runs")
        .select("ran_at, result, items, note")
        .eq("bot_id", b.id)
        .order("ran_at", { ascending: false })
        .limit(10000);
      const runs = (runRows ?? []) as BotRun[];
      return {
        bot: b,
        automation: b.diagnostic_automations!,
        client: { id: b.diagnostic_clients!.id, name: b.diagnostic_clients!.name },
        health: botHealth(b, b.diagnostic_automations!, runs, now),
        savings: botSavings(b, runs, now),
        recent: runs.slice(0, 10),
        lastRunAt: runs[0]?.ran_at ?? null,
      };
    })
  );
}
