import { capacityMap, formatHours, summarize, topNextWins, type MapPoint } from "./hours-back";
import { winPattern } from "./win-patterns";
import { READOUT_SECTIONS, toTask, toWin, type DiagnosticBundle, type Narrative, type ReadoutSection, type RoadmapItem, type TaskRow } from "./types";
import { INTERVIEWS_SHOWN } from "./steps";
import { bundleHasSystemsData, snapshotOf, type AiSummary, type Connection, type SnapshotSystem, type SystemsSnapshot } from "./systems-snapshot";

// THE READOUT, ASSEMBLED. Everything the owner is shown, in the order
// the readout runs, built from the engagement's rows and the figures in
// hours-back.ts. Pure: no database, no model, so the Readout step, the
// readout page, the PDF, the narrative call's input and the published
// copy are one shape and one set of numbers.
//
// Nothing here carries a person's name except an approved quote the
// lead chose to name. Roles stand in for people everywhere else: the
// owner sees combined results, never one person's ratings or answers.

export const MAX_READOUT_QUOTES = 3;

// The promise on every readout (the page and the PDF), the same one read
// to each person before their survey.
export const PRIVACY_LINE =
  "Your team's individual ratings, answers and conversation notes stay with the person running this diagnostic. What you see here is combined.";
const NO_ROLE = "Team member";

// How many hand-carried connections the Systems and AI Snapshot names.
export const MAX_READOUT_CONNECTIONS = 3;

// The Systems and AI Snapshot (phase 4). Systems and how information
// moves between them, and AI use as counts and tool names only: built
// from systems-snapshot.ts's summary, never from a participant's rows,
// so it cannot say who uses which tool.
export type ReadoutSystems = {
  map: { systems: SnapshotSystem[]; connections: Connection[] };
  handCarried: Array<{ from: string; to: string; whatMoves: string[]; hours: number }>;
  // Every hand-carried connection's hours together, the cross-client
  // view's figure.
  handCarriedHours: number;
  ai: AiSummary;
  // 0305. The company-level answer, the AI tools the team uses, in
  // place of each person's; absent where nobody answered it.
  aiTools?: string[];
};

export function readoutSystems(snap: SystemsSnapshot, aiTools: string[] = []): ReadoutSystems {
  return {
    map: { systems: snap.systems, connections: snap.connections },
    handCarried: snap.handCarried.slice(0, MAX_READOUT_CONNECTIONS).map((c) => ({ from: c.from, to: c.to, whatMoves: c.whatMoves, hours: c.hoursCarried })),
    handCarriedHours: snap.handCarriedHours,
    ai: snap.ai,
    ...(aiTools.length ? { aiTools } : {}),
  };
}

// The seventh section's title: the Systems and AI Snapshot where the
// readout has one, the Guardrails Snapshot otherwise, as every readout
// published before phase 4 has it. The narrative keeps its key either
// way, so a stored paragraph is never lost.
// The sections that come from the people interviews. While they are
// hidden (steps.ts) a new readout leaves them out.
const INTERVIEW_SECTIONS: readonly ReadoutSection[] = ["in_their_words", "capacity_map"];

// The sections a readout runs, in order: its own list where it has one,
// every section on a readout published before the list existed.
export function readoutSections(r: Pick<ReadoutData, "sections">): ReadoutSection[] {
  return r.sections ?? READOUT_SECTIONS.map((s) => s.key);
}

// The privacy line speaks for people's ratings and answers, so it
// rides with the interviews' own section.
export function showsPrivacyLine(r: Pick<ReadoutData, "sections">): boolean {
  return readoutSections(r).includes("in_their_words");
}

export function sectionTitle(k: ReadoutSection, r: Pick<ReadoutData, "systems">): string {
  if (k === "guardrails" && r.systems) return "Systems and AI Snapshot";
  return READOUT_SECTIONS.find((s) => s.key === k)!.title;
}

export type ReadoutData = {
  version: 1;
  clientName: string;
  ownerName: string | null;
  preparedOn: string; // YYYY-MM-DD
  quotes: Array<{ text: string; name: string | null }>;
  firstWin: {
    title: string;
    pattern: string;
    serves: string;
    role: string;
    baselineMinutes: number | null;
    afterMinutes: number | null;
    unitsPerWeek: number | null;
    measured: number | null;
    measuredWeekEnding: string | null;
  } | null;
  map: { points: MapPoint[]; tasks: number; candidates: number; totalHours: number; candidateHours: number; checkedHours: number };
  hoursBack: {
    measured: number | null;
    projected: number | null;
    recoveryRate: number | null;
    guaranteeHours: number;
    guaranteeMet: boolean | null;
  };
  destination: {
    text: string | null;
    roles: Array<{ role: string; hours: number; wishes: string[] }>;
    assignedHours: number;
  };
  nextWins: Array<{ title: string; hours: number; people: number; helps: string[]; dataRisk: string | null; buildEffortHours: number | null }>;
  guardrails: { tools: string[]; dataAtRisk: string | null; rules: string[] };
  roadmap: RoadmapItem[];
  narrative: Narrative;
  // Phase 4. Absent on a readout with no systems data, and on every
  // readout published before it: those show the Guardrails section.
  systems?: ReadoutSystems;
  // 0305. The sections this readout runs; absent on every readout
  // published before, which runs them all.
  sections?: ReadoutSection[];
};

// A free-text list, one item per line or comma: the tools in use and
// the three rules are typed that way.
export function splitList(raw: string | null, by: RegExp = /[\n,;]+/): string[] {
  return (raw ?? "")
    .split(by)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export function assembleReadout(b: DiagnosticBundle, preparedOn: string): ReadoutData {
  const d = b.diagnostic;
  const tasks = b.tasks.map(toTask);
  const win = toWin(b.firstWin);
  const summary = summarize(tasks, win, Number(d.guarantee_hours));
  const personRole = new Map(b.participants.map((p) => [p.id, p.role_title?.trim() || NO_ROLE]));
  const nameOf = new Map(b.participants.map((p) => [p.id, p.name]));
  // A task's role: its person's, or the one the lead named for it (0305).
  const roleOfTask = (t: Pick<TaskRow, "participant_id" | "role_title">) =>
    (t.participant_id ? personRole.get(t.participant_id) : null) ?? (t.role_title?.trim() || NO_ROLE);
  const rowOf = new Map(b.tasks.map((t) => [t.id, t]));
  const aiTools = splitList(d.ai_tools ?? null);

  // Approved lines only, oldest approval first, three at most.
  const quotes = b.quotes
    .filter((q) => q.approved_at)
    .sort((x, y) => (x.approved_at! < y.approved_at! ? -1 : 1))
    .slice(0, MAX_READOUT_QUOTES)
    .map((q) => ({ text: q.text, name: q.participant_id ? (nameOf.get(q.participant_id) ?? null) : null }));

  let firstWin: ReadoutData["firstWin"] = null;
  if (b.firstWin) {
    const task = b.tasks.find((t) => t.id === b.firstWin!.task_id);
    firstWin = {
      title: b.firstWin.title,
      pattern: winPattern(b.firstWin.pattern)?.title ?? b.firstWin.pattern,
      serves: task ? task.canonical_title || task.title : "",
      role: task ? roleOfTask(task) : NO_ROLE,
      baselineMinutes: win?.baselineMinutesPerUnit ?? null,
      afterMinutes: win?.afterMinutesPerUnit ?? null,
      unitsPerWeek: win?.unitsPerWeek ?? null,
      measured: summary.measured,
      measuredWeekEnding: b.firstWin.measured_week_ending,
    };
  }

  // Hours toward the destination, summed per role, with what the people
  // in that role said they would do with the time.
  const byRole = new Map<string, { hours: number; wishes: string[] }>();
  for (const n of b.notes) {
    const hours = n.destination_hours == null ? 0 : Number(n.destination_hours);
    const wish = n.redeploy_wish?.trim();
    if (!hours && !wish) continue;
    const role = personRole.get(n.participant_id) ?? NO_ROLE;
    const r = byRole.get(role) ?? { hours: 0, wishes: [] };
    r.hours += hours;
    if (wish) r.wishes.push(wish);
    byRole.set(role, r);
  }
  const roles = [...byRole.entries()]
    .map(([role, r]) => ({ role, hours: r.hours, wishes: r.wishes }))
    .sort((x, y) => y.hours - x.hours || x.role.localeCompare(y.role));

  const nextWins = topNextWins(tasks, win).map((g) => ({
    title: g.title,
    hours: g.hours,
    people: g.people,
    helps: [...new Set(g.taskIds.map((id) => rowOf.get(id)).filter((t): t is TaskRow => Boolean(t)).map(roleOfTask))],
    dataRisk: g.dataRisk,
    buildEffortHours: g.buildEffortHours,
  }));

  return {
    version: 1,
    clientName: b.client.name,
    ownerName: b.client.owner_name,
    preparedOn,
    quotes,
    firstWin,
    map: {
      points: capacityMap(tasks),
      tasks: summary.tasks,
      candidates: summary.candidates,
      totalHours: summary.totalHours,
      candidateHours: summary.candidateHours,
      checkedHours: summary.checkedHours,
    },
    hoursBack: {
      measured: summary.measured,
      projected: summary.projected,
      recoveryRate: summary.recoveryRate,
      guaranteeHours: Number(d.guarantee_hours),
      guaranteeMet: summary.guaranteeMet,
    },
    destination: { text: d.capacity_destination, roles, assignedHours: roles.reduce((s, r) => s + r.hours, 0) },
    nextWins,
    guardrails: { tools: splitList(d.tools_in_use), dataAtRisk: d.data_at_risk, rules: splitList(d.guardrail_rules, /\n+/) },
    roadmap: (d.roadmap ?? []).filter((r) => r.title?.trim()),
    narrative: d.narrative ?? {},
    ...(bundleHasSystemsData(b) || aiTools.length ? { systems: readoutSystems(snapshotOf(b), aiTools) } : {}),
    ...(INTERVIEWS_SHOWN ? {} : { sections: READOUT_SECTIONS.map((s) => s.key).filter((k) => !INTERVIEW_SECTIONS.includes(k)) }),
  };
}

// Why a readout cannot be published yet, or null when it can. The one
// hard rule from the spec: no measured week, no readout.
export function publishBlocker(r: ReadoutData): string | null {
  if (!r.firstWin) return "Choose the first win on the Build step first.";
  if (r.hoursBack.measured == null) return "Enter the first win's measured week on the Build step first.";
  return null;
}

// The recovery rate as a whole percentage.
export function percent(rate: number | null): string {
  return rate == null ? "Not yet" : `${Math.round(rate * 100)}%`;
}

// The one sentence that keeps the two Hours Back numbers apart.
export function hoursBackSentence(h: ReadoutData["hoursBack"]): string {
  if (h.measured == null) return "Measured hours come from the first win's first full week in use.";
  const measured = `${formatHours(h.measured)} hours a week, measured`;
  if (h.projected == null) return `${measured}.`;
  return `${measured}. ${formatHours(h.projected)} more a week projected across the other candidates at the same rate. The projection is an estimate, so it is never added to the measured figure.`;
}

// Every number written in digits, as the page would print it: "1,200"
// reads as 1200, "40%" as 40, "3.5" as 3.5.
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => {
    const raw = m[0].replace(/,(?=\d{3}\b)/g, "").replace(/[.,]+$/, "");
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : raw;
  });
}

// Every figure the readout prints, as the strings the page prints them,
// and every number inside the words it prints (a quote that says "six
// hours" in digits, a roadmap item's week). The narrative call is given
// these and may use no other number.
export function readoutFigures(r: ReadoutData): string[] {
  const out = new Set<string>();
  const add = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return;
    out.add(formatHours(v));
    out.add(String(v));
  };
  add(r.map.tasks);
  add(r.map.candidates);
  add(r.map.totalHours);
  add(r.map.candidateHours);
  add(r.map.checkedHours);
  add(r.hoursBack.measured);
  add(r.hoursBack.projected);
  add(r.hoursBack.guaranteeHours);
  if (r.hoursBack.recoveryRate != null) add(Math.round(r.hoursBack.recoveryRate * 100));
  if (r.firstWin) {
    add(r.firstWin.baselineMinutes);
    add(r.firstWin.afterMinutes);
    add(r.firstWin.unitsPerWeek);
    // The measured week's date, which the readout prints: day and year.
    if (r.firstWin.measuredWeekEnding) r.firstWin.measuredWeekEnding.split("-").map(Number).forEach(add);
  }
  add(r.destination.assignedHours);
  for (const role of r.destination.roles) add(role.hours);
  r.nextWins.forEach((w, i) => {
    add(i + 1);
    add(w.hours);
    add(w.people);
    add(w.buildEffortHours);
  });
  add(r.nextWins.length);
  add(r.guardrails.tools.length);
  add(r.guardrails.rules.length);
  if (r.systems) {
    const sys = r.systems;
    add(sys.map.systems.length);
    add(sys.handCarried.length);
    sys.handCarried.forEach((c) => add(c.hours));
    add(sys.handCarriedHours);
    add(sys.ai.answered);
    add(sys.ai.usingAny);
    add(sys.ai.usingPersonal);
    add(sys.ai.tools.length);
    sys.ai.tools.forEach((t) => add(t.users));
    add(sys.ai.companyProvided);
    add(sys.ai.personal);
    add(sys.aiTools?.length);
  }
  for (const item of r.roadmap) add(item.target_week);
  add(r.roadmap.length);
  add(r.quotes.length);
  // The fixed numbers the readout's own words use.
  [1, 2, 3, 90].forEach(add);
  const words = [
    ...r.quotes.map((q) => q.text),
    r.firstWin?.title,
    r.firstWin?.serves,
    r.destination.text,
    ...r.destination.roles.flatMap((x) => x.wishes),
    ...r.nextWins.map((w) => w.title),
    r.guardrails.dataAtRisk,
    ...r.guardrails.tools,
    ...r.guardrails.rules,
    ...r.roadmap.flatMap((x) => [x.title, x.champion]),
    ...(r.systems ? [...r.systems.map.systems.map((x) => x.name), ...r.systems.handCarried.flatMap((c) => c.whatMoves), ...r.systems.ai.tools.map((t) => t.tool), ...(r.systems.aiTools ?? [])] : []),
  ];
  for (const w of words) if (w) numbersIn(w).forEach((n) => out.add(n));
  return [...out];
}

// The lead's Markdown copy: the roadmap, the Top 3 next wins and the
// Capacity Destination, so anything the sprint needs on the platform is
// typed in where it belongs, by a person who has decided it belongs.
export function readoutMarkdown(r: ReadoutData): string {
  const lines: string[] = [`# ${r.clientName}: Capacity Diagnostic readout`, "", `Prepared ${r.preparedOn}.`, ""];
  lines.push("## The Capacity Destination", "");
  lines.push(r.destination.text?.trim() || "Not named yet.", "");
  if (r.destination.roles.length) {
    for (const role of r.destination.roles) {
      lines.push(`- ${role.role}: ${formatHours(role.hours)} hours a week${role.wishes.length ? `. ${joinWishes(role.wishes)}` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Top 3 next wins", "");
  if (r.nextWins.length === 0) lines.push("None yet.", "");
  r.nextWins.forEach((w, i) => {
    lines.push(
      `${i + 1}. ${w.title}: ${formatHours(w.hours)} hours a week, helps ${w.helps.join(", ") || "the team"}; data risk ${w.dataRisk ?? "not set"}; build ${w.buildEffortHours == null ? "not estimated" : `${formatHours(w.buildEffortHours)} hours`}`
    );
  });
  if (r.nextWins.length) lines.push("");
  lines.push("## The 90-day roadmap", "");
  if (r.roadmap.length === 0) lines.push("Not set yet.", "");
  r.roadmap.forEach((item, i) => {
    const week = item.target_week ? `week ${item.target_week}` : "week not set";
    lines.push(`${i + 1}. ${item.title} (${week})${item.champion?.trim() ? `, champion: ${item.champion.trim()}` : ""}`);
  });
  return lines.join("\n").trimEnd() + "\n";
}

// What the people in one role would do with the time, as one line.
export function joinWishes(wishes: readonly string[]): string {
  return wishes.map((w) => w.replace(/[.;,\s]+$/, "")).join("; ");
}

// For the PDF and the page: the published copy when there is one, so
// what the owner was given never drifts; otherwise the live draft.
export function isReadoutData(v: unknown): v is ReadoutData {
  return Boolean(v && typeof v === "object" && (v as { version?: unknown }).version === 1);
}
