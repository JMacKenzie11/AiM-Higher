// THE CAPACITY DIAGNOSTIC'S NUMBERS. Every figure the engagement page,
// the readout and its PDF show comes from here, so a number cannot
// differ between the screen and the document. Pure: no database, no
// model. The model writes words around these figures; it never makes
// one (Capacity Diagnostic build spec, "The numbers", 2026-10-22).

export const CANDIDATE_ENERGY_MAX = 2;
export const CANDIDATE_JUDGMENT_MAX = 2;
export const QUICK_WIN_BUILD_HOURS_MAX = 4;
export const DEFAULT_GUARANTEE_HOURS = 3;
export const MAX_TASKS_PER_PARTICIPANT = 10;

export type DataRisk = "low" | "medium" | "high";
export type BuildEffortStep = "half_day" | "one_two_days" | "more";

// THE CANDIDATE SCORE (0309; Jason, 2026-10-29), every weight in one
// place. Hours a week count up; data risk and build effort count down.
// A candidate not yet scored on one of them takes that one's "unset"
// weight, so scoring it can move it either way and an unscored task
// never hides at the top.
export const SCORE_WEIGHTS = {
  perHour: 10,
  dataRisk: { low: 0, medium: -20, high: -50, unset: -15 },
  buildEffort: { half_day: 0, one_two_days: -15, more: -35, unset: -10 },
} as const;

export type ScoreBreakdown = { hours: number; dataRisk: number; buildEffort: number };

// A build in hours as the three steps, for a task scored before 0309.
export function effortFromHours(h: number | null): BuildEffortStep | null {
  if (h == null) return null;
  return h <= 4 ? "half_day" : h <= 16 ? "one_two_days" : "more";
}

export type DiagnosticTask = {
  id: string;
  // Null, with no ratings, for a task the lead entered in the systems
  // walkthrough (0305); roleTitle says who does it.
  participantId: string | null;
  title: string;
  canonicalTitle: string | null;
  hoursPerWeek: number;
  energy: number | null;
  judgment: number | null;
  volumeUnitsPerWeek: number | null;
  minutesPerUnit: number | null;
  dataRisk: DataRisk | null;
  buildEffortHours: number | null;
  // 0309. Optional so a task built without them reads as unscored.
  buildEffort?: BuildEffortStep | null;
  frequency?: "daily" | "weekly" | "monthly" | "ad_hoc" | null;
  needsApproval?: boolean | null;
  agentType?: string | null;
  candidateOverride: boolean | null;
  // 0298. Optional so a task built without them reads as no system and
  // no copying.
  systemId?: string | null;
  copiesFromSystemId?: string | null;
  copiesToSystemId?: string | null;
  roleTitle?: string | null;
};

export type DiagnosticWin = {
  taskId: string;
  baselineMinutesPerUnit: number | null;
  afterMinutesPerUnit: number | null;
  unitsPerWeek: number | null;
  measuredWeekEnding: string | null;
};

// The volume check: units per week times minutes per unit, over 60.
// Null until both are entered. Derived, never stored, so a corrected
// count cannot leave a stale total behind.
export function hoursChecked(t: Pick<DiagnosticTask, "volumeUnitsPerWeek" | "minutesPerUnit">): number | null {
  if (t.volumeUnitsPerWeek == null || t.minutesPerUnit == null) return null;
  return (t.volumeUnitsPerWeek * t.minutesPerUnit) / 60;
}

// The hours a task counts for: checked when the volume check is filled,
// otherwise as the person reported it. `checked` says which.
export function taskHours(t: DiagnosticTask): { hours: number; checked: boolean } {
  const checked = hoursChecked(t);
  return checked == null ? { hours: t.hoursPerWeek, checked: false } : { hours: checked, checked: true };
}

// Draining and routine, unless the lead has decided otherwise. A task
// nobody rated (the lead entered it as work to take off people's
// plates, 0305) is a candidate until the lead says it is not.
export function isCandidate(t: Pick<DiagnosticTask, "energy" | "judgment" | "candidateOverride">): boolean {
  if (t.candidateOverride != null) return t.candidateOverride;
  if (t.energy == null || t.judgment == null) return true;
  return t.energy <= CANDIDATE_ENERGY_MAX && t.judgment <= CANDIDATE_JUDGMENT_MAX;
}

// Who a task belongs to, for counting heads: the person, else the role
// the lead named, else the task itself.
function whoKey(t: Pick<DiagnosticTask, "id" | "participantId" | "roleTitle">): string {
  if (t.participantId) return `person:${t.participantId}`;
  const role = t.roleTitle?.trim().toLowerCase();
  return role ? `role:${role}` : `task:${t.id}`;
}

// What rolls tasks up: the canonical title when there is one, so
// "quotes" and "quoting" are one row; the typed title otherwise.
export function groupKey(t: Pick<DiagnosticTask, "title" | "canonicalTitle">): string {
  return (t.canonicalTitle?.trim() || t.title).trim().toLowerCase().replace(/\s+/g, " ");
}

function groupLabel(t: Pick<DiagnosticTask, "title" | "canonicalTitle">): string {
  return t.canonicalTitle?.trim() || t.title.trim();
}

const RISK_ORDER: Record<DataRisk, number> = { low: 0, medium: 1, high: 2 };
const EFFORT_ORDER: Record<BuildEffortStep, number> = { half_day: 0, one_two_days: 1, more: 2 };

// A task's build effort: the three steps, or its hours read as them.
export function taskEffort(t: Pick<DiagnosticTask, "buildEffort" | "buildEffortHours">): BuildEffortStep | null {
  return t.buildEffort ?? effortFromHours(t.buildEffortHours);
}

// The score and its parts, from a candidate's hours, worst data risk and
// largest build effort (SCORE_WEIGHTS).
export function scoreCandidate(hours: number, dataRisk: DataRisk | null, effort: BuildEffortStep | null): { score: number; breakdown: ScoreBreakdown } {
  const breakdown = {
    hours: hours * SCORE_WEIGHTS.perHour,
    dataRisk: SCORE_WEIGHTS.dataRisk[dataRisk ?? "unset"],
    buildEffort: SCORE_WEIGHTS.buildEffort[effort ?? "unset"],
  };
  return { score: breakdown.hours + breakdown.dataRisk + breakdown.buildEffort, breakdown };
}

export type CandidateGroup = {
  key: string;
  title: string;
  taskIds: string[];
  people: number;
  hours: number;
  checkedHours: number;
  score: number;
  breakdown: ScoreBreakdown;
  // The worst risk and the largest build effort among its tasks; null
  // while any task is unassessed on that one.
  dataRisk: DataRisk | null;
  buildEffort: BuildEffortStep | null;
  // The largest build in hours, for a readout published before 0309.
  buildEffortHours: number | null;
  // Low data risk and a build of half a day or less: what Top 3 Next
  // Wins is filtered to. A filter on top of the score: a risky or slow
  // build never makes the Top 3 on hours alone.
  quickWin: boolean;
};

// Candidate score (SCORE_WEIGHTS): the group's hours a week weighted up,
// its worst data risk and largest build effort weighted down. Tasks
// sharing a canonical title are one group. Highest first.
export function candidateGroups(tasks: readonly DiagnosticTask[]): CandidateGroup[] {
  type Acc = { key: string; title: string; taskIds: string[]; hours: number; checkedHours: number; who: Set<string>; risk: DataRisk | null; riskUnset: boolean; effort: BuildEffortStep | null; effortUnset: boolean; effortHours: number | null };
  const groups = new Map<string, Acc>();
  for (const t of tasks) {
    if (!isCandidate(t)) continue;
    const key = groupKey(t);
    const g: Acc =
      groups.get(key) ??
      { key, title: groupLabel(t), taskIds: [], hours: 0, checkedHours: 0, who: new Set<string>(), risk: null, riskUnset: false, effort: null, effortUnset: false, effortHours: null };
    const { hours, checked } = taskHours(t);
    g.who.add(whoKey(t));
    g.taskIds.push(t.id);
    g.hours += hours;
    if (checked) g.checkedHours += hours;
    if (t.dataRisk == null) g.riskUnset = true;
    else if (g.risk == null || RISK_ORDER[t.dataRisk] > RISK_ORDER[g.risk]) g.risk = t.dataRisk;
    const effort = taskEffort(t);
    if (effort == null) g.effortUnset = true;
    else if (g.effort == null || EFFORT_ORDER[effort] > EFFORT_ORDER[g.effort]) g.effort = effort;
    if (t.buildEffortHours != null) g.effortHours = Math.max(g.effortHours ?? 0, t.buildEffortHours);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g): CandidateGroup => {
      const dataRisk = g.riskUnset ? null : g.risk;
      const buildEffort = g.effortUnset ? null : g.effort;
      const { score, breakdown } = scoreCandidate(g.hours, dataRisk, buildEffort);
      return {
        key: g.key,
        title: g.title,
        taskIds: g.taskIds,
        people: g.who.size,
        hours: g.hours,
        checkedHours: g.checkedHours,
        score,
        breakdown,
        dataRisk,
        buildEffort,
        buildEffortHours: g.effortUnset ? null : g.effortHours,
        quickWin: dataRisk === "low" && buildEffort === "half_day",
      };
    })
    .sort((a, b) => b.score - a.score || b.hours - a.hours || a.title.localeCompare(b.title));
}

// The first win's measured week: (baseline - after) * units / 60.
// Null until the week is entered; the readout cannot publish without it.
export function measuredHoursBack(w: DiagnosticWin | null): number | null {
  if (!w || !w.measuredWeekEnding) return null;
  if (w.baselineMinutesPerUnit == null || w.afterMinutesPerUnit == null || w.unitsPerWeek == null) return null;
  return ((w.baselineMinutesPerUnit - w.afterMinutesPerUnit) * w.unitsPerWeek) / 60;
}

// Measured hours back over the first win's task hours before the build.
// The one number the projection inherits.
export function recoveryRate(w: DiagnosticWin | null, tasks: readonly DiagnosticTask[]): number | null {
  const measured = measuredHoursBack(w);
  if (measured == null || !w) return null;
  const task = tasks.find((t) => t.id === w.taskId);
  if (!task) return null;
  const { hours } = taskHours(task);
  return hours > 0 ? measured / hours : null;
}

// Hours over the remaining candidates (every candidate task but the
// first win's own) times the recovery rate. Reported beside the
// measured figure, never added to it; undefined until the first win has
// a measured week.
export function projectedHoursBack(w: DiagnosticWin | null, tasks: readonly DiagnosticTask[]): number | null {
  const rate = recoveryRate(w, tasks);
  if (rate == null || !w) return null;
  const remaining = tasks.filter((t) => t.id !== w.taskId && isCandidate(t)).reduce((sum, t) => sum + taskHours(t).hours, 0);
  return remaining * rate;
}

// The first win gives its person at least the guaranteed hours back.
export function guaranteeMet(w: DiagnosticWin | null, guaranteeHours: number = DEFAULT_GUARANTEE_HOURS): boolean | null {
  const measured = measuredHoursBack(w);
  return measured == null ? null : measured >= guaranteeHours;
}

// Top 3 Next Wins: candidates with low data risk and a build of half a
// day or less, highest score first, leaving out the group the first win
// came from. Fewer than three when fewer qualify.
export function topNextWins(tasks: readonly DiagnosticTask[], w: DiagnosticWin | null, n = 3): CandidateGroup[] {
  const firstKey = w ? tasks.find((t) => t.id === w.taskId) : undefined;
  const skip = firstKey ? groupKey(firstKey) : null;
  return candidateGroups(tasks).filter((g) => g.quickWin && g.key !== skip).slice(0, n);
}

export type MapPoint = {
  taskId: string;
  key: string;
  title: string;
  energy: number;
  judgment: number;
  hours: number;
  checked: boolean;
  candidate: boolean;
  // Copies information from one system to another (0298): the map
  // rings it. Absent rather than false, so a readout published before
  // phase 4 holds exactly the points it held.
  copying?: true;
};

// One dot per rated task for the Capacity Map, grouped by canonical
// title so the same work sits together. A task nobody rated has no
// place on it.
export function capacityMap(tasks: readonly DiagnosticTask[]): MapPoint[] {
  return tasks
    .flatMap((t) => (t.energy == null || t.judgment == null ? [] : [{ ...t, energy: t.energy, judgment: t.judgment }]))
    .map((t) => {
      const { hours, checked } = taskHours(t);
      const point: MapPoint = { taskId: t.id, key: groupKey(t), title: groupLabel(t), energy: t.energy, judgment: t.judgment, hours, checked, candidate: isCandidate(t) };
      if (t.copiesFromSystemId && t.copiesToSystemId) point.copying = true;
      return point;
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export type CapacitySummary = {
  tasks: number;
  candidates: number;
  totalHours: number;
  candidateHours: number;
  checkedHours: number;
  measured: number | null;
  recoveryRate: number | null;
  projected: number | null;
  guaranteeMet: boolean | null;
};

export function summarize(tasks: readonly DiagnosticTask[], w: DiagnosticWin | null, guaranteeHours = DEFAULT_GUARANTEE_HOURS): CapacitySummary {
  let totalHours = 0, candidateHours = 0, checkedHours = 0, candidates = 0;
  for (const t of tasks) {
    const { hours, checked } = taskHours(t);
    totalHours += hours;
    if (checked) checkedHours += hours;
    if (isCandidate(t)) {
      candidates += 1;
      candidateHours += hours;
    }
  }
  return {
    tasks: tasks.length,
    candidates,
    totalHours,
    candidateHours,
    checkedHours,
    measured: measuredHoursBack(w),
    recoveryRate: recoveryRate(w, tasks),
    projected: projectedHoursBack(w, tasks),
    guaranteeMet: guaranteeMet(w, guaranteeHours),
  };
}

// One decimal, for display. The figures themselves are never rounded.
export function formatHours(h: number | null): string {
  if (h == null) return "Not yet";
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
