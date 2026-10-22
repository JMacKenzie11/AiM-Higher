import type { DataRisk, DiagnosticTask, DiagnosticWin } from "./hours-back";

// The Capacity Diagnostic's rows as the pages read them (0294).

export const CLIENT_SOURCES = [
  { value: "referral", label: "Referral" },
  { value: "peer_group", label: "Peer group" },
  { value: "association", label: "Association" },
  { value: "lift", label: "LIFT" },
  { value: "other", label: "Other" },
] as const;
export type ClientSource = (typeof CLIENT_SOURCES)[number]["value"];

export const DIAGNOSTIC_STATUSES = [
  { value: "preflight", label: "Pre-flight" },
  { value: "kickoff", label: "Kickoff" },
  { value: "survey", label: "Survey" },
  { value: "conversations", label: "Conversations" },
  { value: "build", label: "Build" },
  { value: "readout", label: "Readout" },
  { value: "decided", label: "Decided" },
] as const;
export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number]["value"];

export const DECISIONS = [
  { value: "pending", label: "Pending" },
  { value: "sprint", label: "Sprint" },
  { value: "declined", label: "Declined" },
] as const;
export type Decision = (typeof DECISIONS)[number]["value"];

export function statusLabel(s: string): string {
  return DIAGNOSTIC_STATUSES.find((x) => x.value === s)?.label ?? s;
}
export function decisionLabel(s: string): string {
  return DECISIONS.find((x) => x.value === s)?.label ?? s;
}

export type ClientRow = {
  id: string;
  name: string;
  owner_name: string | null;
  owner_email: string | null;
  industry: string | null;
  employee_count: number | null;
  city: string | null;
  country: "CA" | "US" | null;
  source: ClientSource | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
};
export const CLIENT_COLUMNS =
  "id, name, owner_name, owner_email, industry, employee_count, city, country, source, notes, archived_at, created_at";

export type DiagnosticRow = {
  id: string;
  client_id: string;
  status: DiagnosticStatus;
  tools_in_use: string | null;
  it_contact: string | null;
  access_secured: boolean;
  brief_sent: boolean;
  conversations_booked: boolean;
  scope: string | null;
  capacity_destination: string | null;
  pledge_text: string | null;
  pledge_sent_at: string | null;
  kickoff_at: string | null;
  midpoint_at: string | null;
  midpoint_note: string | null;
  readout_at: string | null;
  published_at: string | null;
  guarantee_hours: number;
  decision: Decision;
  archived_at: string | null;
  created_at: string;
  // Phase 2 (0296).
  data_at_risk: string | null;
  guardrail_rules: string | null;
  roadmap: RoadmapItem[];
  narrative: Narrative | null;
  published_readout: unknown;
  decided_at: string | null;
};
export const DIAGNOSTIC_COLUMNS =
  "id, client_id, status, tools_in_use, it_contact, access_secured, brief_sent, conversations_booked, scope, capacity_destination, pledge_text, pledge_sent_at, kickoff_at, midpoint_at, midpoint_note, readout_at, published_at, guarantee_hours, decision, archived_at, created_at, data_at_risk, guardrail_rules, roadmap, narrative, published_readout, decided_at";

// One line of the 90-day roadmap: a next win, the week of the sprint it
// is meant to land in, and the person to train as its champion.
export type RoadmapItem = { title: string; target_week: number | null; champion: string };

// The readout's sections, in the order the readout runs (the team's
// own words first). The narrative call writes one short paragraph for
// each; the lead can edit them until publishing.
export const READOUT_SECTIONS = [
  { key: "in_their_words", title: "In Their Words" },
  { key: "first_win", title: "The First Win" },
  { key: "capacity_map", title: "The Capacity Map" },
  { key: "hours_back", title: "Hours Back" },
  { key: "destination", title: "The Capacity Destination" },
  { key: "next_wins", title: "Top 3 Next Wins" },
  { key: "guardrails", title: "Guardrails Snapshot" },
  { key: "roadmap", title: "The 90-Day Roadmap" },
] as const;
export type ReadoutSection = (typeof READOUT_SECTIONS)[number]["key"];
export type Narrative = Partial<Record<ReadoutSection, string>>;

export type ParticipantRow = {
  id: string;
  diagnostic_id: string;
  name: string;
  role_title: string | null;
  email: string | null;
  years_with_company: number | null;
  survey_entered_at: string | null;
  in_conversations: boolean;
  conversation_at: string | null;
  created_at: string;
};
export const PARTICIPANT_COLUMNS =
  "id, diagnostic_id, name, role_title, email, years_with_company, survey_entered_at, in_conversations, conversation_at, created_at";

export type TaskRow = {
  id: string;
  diagnostic_id: string;
  participant_id: string;
  title: string;
  hours_per_week: number;
  energy: number;
  judgment: number;
  source: "survey" | "conversation" | "lead";
  volume_units_per_week: number | null;
  minutes_per_unit: number | null;
  data_risk: DataRisk | null;
  build_effort_hours: number | null;
  candidate_override: boolean | null;
  canonical_title: string | null;
  created_at: string;
};
export const TASK_COLUMNS =
  "id, diagnostic_id, participant_id, title, hours_per_week, energy, judgment, source, volume_units_per_week, minutes_per_unit, data_risk, build_effort_hours, candidate_override, canonical_title, created_at";

export type AnswerRow = {
  participant_id: string;
  best_work: string | null;
  task_to_lose: string | null;
  trust_needs: string | null;
};

export type NoteRow = {
  participant_id: string;
  body: string;
  peak_experience: string | null;
  redeploy_wish: string | null;
  destination_hours: number | null;
};

export type QuoteRow = {
  id: string;
  participant_id: string | null;
  text: string;
  approved_at: string | null;
  created_at: string;
};

export type WinRow = {
  id: string;
  task_id: string;
  pattern: string;
  title: string;
  built_at: string | null;
  in_use_from: string | null;
  baseline_minutes_per_unit: number | null;
  after_minutes_per_unit: number | null;
  units_per_week: number | null;
  measured_week_ending: string | null;
  is_first_win: boolean;
};
export const WIN_COLUMNS =
  "id, task_id, pattern, title, built_at, in_use_from, baseline_minutes_per_unit, after_minutes_per_unit, units_per_week, measured_week_ending, is_first_win";

// numeric columns arrive as numbers from PostgREST, but a null-safe
// cast keeps the arithmetic honest if one ever arrives as a string.
const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function toTask(r: TaskRow): DiagnosticTask {
  return {
    id: r.id,
    participantId: r.participant_id,
    title: r.title,
    canonicalTitle: r.canonical_title,
    hoursPerWeek: Number(r.hours_per_week),
    energy: r.energy,
    judgment: r.judgment,
    volumeUnitsPerWeek: num(r.volume_units_per_week),
    minutesPerUnit: num(r.minutes_per_unit),
    dataRisk: r.data_risk,
    buildEffortHours: num(r.build_effort_hours),
    candidateOverride: r.candidate_override,
  };
}

export function toWin(r: WinRow | null): DiagnosticWin | null {
  if (!r) return null;
  return {
    taskId: r.task_id,
    baselineMinutesPerUnit: num(r.baseline_minutes_per_unit),
    afterMinutesPerUnit: num(r.after_minutes_per_unit),
    unitsPerWeek: num(r.units_per_week),
    measuredWeekEnding: r.measured_week_ending,
  };
}

export type DiagnosticBundle = {
  diagnostic: DiagnosticRow;
  client: ClientRow;
  participants: ParticipantRow[];
  tasks: TaskRow[];
  answers: AnswerRow[];
  notes: NoteRow[];
  quotes: QuoteRow[];
  firstWin: WinRow | null;
};
