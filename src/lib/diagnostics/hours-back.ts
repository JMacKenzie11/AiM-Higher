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

export type DiagnosticTask = {
  id: string;
  participantId: string;
  title: string;
  canonicalTitle: string | null;
  hoursPerWeek: number;
  energy: number;
  judgment: number;
  volumeUnitsPerWeek: number | null;
  minutesPerUnit: number | null;
  dataRisk: DataRisk | null;
  buildEffortHours: number | null;
  candidateOverride: boolean | null;
  // 0298. Optional so a task built without them reads as no system and
  // no copying.
  systemId?: string | null;
  copiesFromSystemId?: string | null;
  copiesToSystemId?: string | null;
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

// Draining and routine, unless the lead has decided otherwise.
export function isCandidate(t: Pick<DiagnosticTask, "energy" | "judgment" | "candidateOverride">): boolean {
  if (t.candidateOverride != null) return t.candidateOverride;
  return t.energy <= CANDIDATE_ENERGY_MAX && t.judgment <= CANDIDATE_JUDGMENT_MAX;
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

export type CandidateGroup = {
  key: string;
  title: string;
  taskIds: string[];
  people: number;
  hours: number;
  checkedHours: number;
  score: number;
  // The worst risk and the largest build effort among its tasks; null
  // while any task is unassessed.
  dataRisk: DataRisk | null;
  buildEffortHours: number | null;
  // Low risk and a build under the quick-win ceiling. A filter, never a
  // weight: a dangerous or slow build never outranks a safe quick one
  // on hours alone.
  quickWin: boolean;
};

// Candidate score: hours * (6 - energy) * (6 - judgment), summed across
// every candidate task sharing a canonical title. Highest first.
export function candidateGroups(tasks: readonly DiagnosticTask[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup & { unassessed: boolean; who: Set<string> }>();
  for (const t of tasks) {
    if (!isCandidate(t)) continue;
    const key = groupKey(t);
    const g =
      groups.get(key) ??
      { key, title: groupLabel(t), taskIds: [], people: 0, hours: 0, checkedHours: 0, score: 0, dataRisk: null, buildEffortHours: null, quickWin: false, unassessed: false, who: new Set<string>() };
    const { hours, checked } = taskHours(t);
    g.who.add(t.participantId);
    g.people = g.who.size;
    g.taskIds.push(t.id);
    g.hours += hours;
    if (checked) g.checkedHours += hours;
    g.score += hours * (6 - t.energy) * (6 - t.judgment);
    if (t.dataRisk == null || t.buildEffortHours == null) g.unassessed = true;
    else {
      if (g.dataRisk == null || RISK_ORDER[t.dataRisk] > RISK_ORDER[g.dataRisk]) g.dataRisk = t.dataRisk;
      g.buildEffortHours = Math.max(g.buildEffortHours ?? 0, t.buildEffortHours);
    }
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ unassessed, who: _who, ...g }) => {
      const out: CandidateGroup = unassessed ? { ...g, dataRisk: null, buildEffortHours: null } : g;
      out.quickWin = out.dataRisk === "low" && out.buildEffortHours != null && out.buildEffortHours <= QUICK_WIN_BUILD_HOURS_MAX;
      return out;
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

// The top next wins: the highest-scoring quick-win groups, leaving out
// the group the first win came from.
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

// One dot per task for the Capacity Map, grouped by canonical title so
// the same work sits together.
export function capacityMap(tasks: readonly DiagnosticTask[]): MapPoint[] {
  return tasks
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
