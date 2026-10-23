import { taskHours, type DiagnosticTask } from "./hours-back";
import { toTask, type AiUseRow, type DiagnosticBundle, type LinkHow, type ParticipantRow, type SystemKind, type SystemLinkRow, type SystemRow } from "./types";

// THE SYSTEMS AND AI NUMBERS (phase 4). Beside hours-back.ts and as
// pure: no database, no model. It reads the same task rows, and a
// task's hours are hours-back.ts's (checked when the volume check is
// filled, reported otherwise), never worked out again here.
//
// A CONNECTION is one ordered pair of systems with at least one link:
// every link from A to B, whatever moves along it, is one arrow on the
// map and one row in the ranking, so two links between the same two
// systems cannot count a task's hours twice. It is hand-carried when
// any of its links is typed in again or exported and imported.
//
// A task copying from A to B counts against the connection A to B, and
// against B to A only when there is no A to B (Jason, 2026-10-23:
// same way first, never both). A copy pair no connection covers is
// listed as unlinked, so the assessor can add the link it implies.
//
// Copying is not a candidate rule: a copying task is a candidate or not
// by isCandidate alone, and the Capacity Map rings it.

export const HAND_CARRIED: readonly LinkHow[] = ["retyped", "export_import"];

export type SnapshotSystem = { id: string; name: string; kind: SystemKind };

export type Connection = {
  fromId: string;
  toId: string;
  from: string;
  to: string;
  whatMoves: string[];
  // The links' own answers, strongest first: typed in again before
  // exported and imported, before automatic, before not sure.
  how: LinkHow;
  handCarried: boolean;
  hoursCarried: number;
  tasks: number;
};

export type UnlinkedCopy = { fromId: string; toId: string; from: string; to: string; tasks: number; hours: number };

// What the owner may see about AI use: counts and tool names. Built
// from the rows here and nowhere else, so the readout never holds who
// uses which tool.
export type AiSummary = {
  // Surveyed people who answered the AI questions: at least one tool,
  // or "None".
  answered: number;
  usingAny: number;
  // People with at least one tool they found themselves.
  usingPersonal: number;
  tools: Array<{ tool: string; users: number }>;
  // Tool rows by who provided them.
  companyProvided: number;
  personal: number;
};

export type SystemsSnapshot = {
  systems: SnapshotSystem[];
  connections: Connection[];
  handCarried: Connection[];
  handCarriedHours: number;
  unlinked: UnlinkedCopy[];
  ai: AiSummary;
  // Assessor only: what people said they use AI for, as written. Never
  // in the readout.
  usesAsWritten: string[];
};

export type SnapshotInput = {
  systems: readonly Pick<SystemRow, "id" | "name" | "kind">[];
  links: readonly Pick<SystemLinkRow, "from_system_id" | "to_system_id" | "what_moves" | "how">[];
  tasks: readonly DiagnosticTask[];
  participants: readonly Pick<ParticipantRow, "id" | "survey_entered_at" | "uses_no_ai">[];
  aiUse: readonly Pick<AiUseRow, "participant_id" | "tool" | "provided_by" | "used_for">[];
};

const HOW_ORDER: readonly LinkHow[] = ["retyped", "export_import", "automatic", "unknown"];
const pairKey = (from: string, to: string) => `${from}>${to}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function hasSystemsData(input: Pick<SnapshotInput, "systems" | "participants" | "aiUse">): boolean {
  return input.systems.length > 0 || input.aiUse.length > 0 || input.participants.some((p) => p.uses_no_ai);
}

export function aiSummary(participants: SnapshotInput["participants"], aiUse: SnapshotInput["aiUse"]): AiSummary {
  const surveyed = new Set(participants.filter((p) => p.survey_entered_at).map((p) => p.id));
  const rows = aiUse.filter((u) => surveyed.has(u.participant_id) && u.tool.trim());
  const users = new Set(rows.map((u) => u.participant_id));
  const answered = participants.filter((p) => surveyed.has(p.id) && (p.uses_no_ai || users.has(p.id))).length;
  // One tool however it was typed: "ChatGPT" and "chatgpt" are one,
  // named as first written.
  const tools = new Map<string, { tool: string; people: Set<string> }>();
  for (const u of rows) {
    const key = u.tool.trim().toLowerCase().replace(/\s+/g, " ");
    const t = tools.get(key) ?? { tool: u.tool.trim().replace(/\s+/g, " "), people: new Set<string>() };
    t.people.add(u.participant_id);
    tools.set(key, t);
  }
  return {
    answered,
    usingAny: users.size,
    usingPersonal: new Set(rows.filter((u) => u.provided_by === "personal").map((u) => u.participant_id)).size,
    tools: [...tools.values()]
      .map((t) => ({ tool: t.tool, users: t.people.size }))
      .sort((a, b) => b.users - a.users || a.tool.localeCompare(b.tool)),
    companyProvided: rows.filter((u) => u.provided_by === "company").length,
    personal: rows.filter((u) => u.provided_by === "personal").length,
  };
}

export function systemsSnapshot(input: SnapshotInput): SystemsSnapshot {
  const names = new Map(input.systems.map((s) => [s.id, s.name]));
  const known = (id: string | null | undefined): id is string => Boolean(id && names.has(id));

  const connections = new Map<string, Connection>();
  for (const l of input.links) {
    if (!known(l.from_system_id) || !known(l.to_system_id)) continue;
    const key = pairKey(l.from_system_id, l.to_system_id);
    const c =
      connections.get(key) ??
      ({ fromId: l.from_system_id, toId: l.to_system_id, from: names.get(l.from_system_id)!, to: names.get(l.to_system_id)!, whatMoves: [], how: "unknown", handCarried: false, hoursCarried: 0, tasks: 0 } as Connection);
    c.whatMoves.push(l.what_moves);
    if (HOW_ORDER.indexOf(l.how) < HOW_ORDER.indexOf(c.how)) c.how = l.how;
    if (HAND_CARRIED.includes(l.how)) c.handCarried = true;
    connections.set(key, c);
  }

  const unlinked = new Map<string, UnlinkedCopy>();
  for (const t of input.tasks) {
    const from = t.copiesFromSystemId, to = t.copiesToSystemId;
    if (!known(from) || !known(to) || from === to) continue;
    const { hours } = taskHours(t);
    const c = connections.get(pairKey(from, to)) ?? connections.get(pairKey(to, from));
    if (c) {
      c.hoursCarried += hours;
      c.tasks += 1;
      continue;
    }
    const key = pairKey(from, to);
    const u = unlinked.get(key) ?? { fromId: from, toId: to, from: names.get(from)!, to: names.get(to)!, tasks: 0, hours: 0 };
    u.tasks += 1;
    u.hours += hours;
    unlinked.set(key, u);
  }

  const all = [...connections.values()].map((c) => ({ ...c, hoursCarried: round1(c.hoursCarried) }));
  const handCarried = all
    .filter((c) => c.handCarried)
    .sort((a, b) => b.hoursCarried - a.hoursCarried || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return {
    systems: input.systems.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    connections: all,
    handCarried,
    handCarriedHours: round1(handCarried.reduce((n, c) => n + c.hoursCarried, 0)),
    unlinked: [...unlinked.values()].map((u) => ({ ...u, hours: round1(u.hours) })).sort((a, b) => b.hours - a.hours),
    ai: aiSummary(input.participants, input.aiUse),
    usesAsWritten: input.aiUse.map((u) => u.used_for?.trim() ?? "").filter(Boolean),
  };
}

// The snapshot of one engagement, from its bundle.
export function snapshotOf(b: Pick<DiagnosticBundle, "systems" | "links" | "tasks" | "participants" | "aiUse">): SystemsSnapshot {
  return systemsSnapshot({ systems: b.systems ?? [], links: b.links ?? [], tasks: b.tasks.map(toTask), participants: b.participants, aiUse: b.aiUse ?? [] });
}

export function bundleHasSystemsData(b: Pick<DiagnosticBundle, "systems" | "participants" | "aiUse">): boolean {
  return hasSystemsData({ systems: b.systems ?? [], participants: b.participants, aiUse: b.aiUse ?? [] });
}
