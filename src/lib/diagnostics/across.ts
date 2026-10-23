import { CLIENT_SOURCES } from "./types";
import { isReadoutData } from "./readout";

// ACROSS CLIENTS (phase 3): how the diagnostics have gone, taken
// together. Pure, so it is tested with no database. Only a published
// readout counts toward the hours and the guarantee, because only then
// are its figures fixed (published_readout); the decision is the one
// the lead recorded after it. A diagnostic still running counts as
// running and nothing more.

export type AcrossInput = {
  published_at: string | null;
  published_readout: unknown;
  decision: string;
  industry: string | null;
  source: string | null;
};

export type AcrossRow = {
  label: string;
  running: number;
  readouts: number;
  guaranteeMet: number;
  sprint: number;
  declined: number;
  pending: number;
  // Averages over the published readouts with a measured figure; null
  // when there are none.
  averageMeasured: number | null;
  averageProjected: number | null;
  // Phase 4, from readouts with a Systems and AI Snapshot only; null
  // when there are none. Hours a week carried between systems by hand,
  // averaged per readout; and of everyone who answered the AI questions
  // across them, the share using a tool they found themselves.
  averageHandCarried: number | null;
  personalAiShare: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function average(values: number[]): number | null {
  return values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

export function acrossRow(label: string, rows: readonly AcrossInput[]): AcrossRow {
  const measured: number[] = [];
  const projected: number[] = [];
  const handCarried: number[] = [];
  let answered = 0, personal = 0;
  const out: AcrossRow = {
    label,
    running: 0,
    readouts: 0,
    guaranteeMet: 0,
    sprint: 0,
    declined: 0,
    pending: 0,
    averageMeasured: null,
    averageProjected: null,
    averageHandCarried: null,
    personalAiShare: null,
  };
  for (const d of rows) {
    const r = d.published_at && isReadoutData(d.published_readout) ? d.published_readout : null;
    if (!r) {
      out.running += 1;
      continue;
    }
    out.readouts += 1;
    if (r.hoursBack.guaranteeMet) out.guaranteeMet += 1;
    if (r.hoursBack.measured != null) measured.push(r.hoursBack.measured);
    if (r.hoursBack.projected != null) projected.push(r.hoursBack.projected);
    if (r.systems) {
      if (r.systems.map.systems.length) handCarried.push(r.systems.handCarriedHours);
      answered += r.systems.ai.answered;
      personal += r.systems.ai.usingPersonal;
    }
    if (d.decision === "sprint") out.sprint += 1;
    else if (d.decision === "declined") out.declined += 1;
    else out.pending += 1;
  }
  out.averageMeasured = average(measured);
  out.averageProjected = average(projected);
  out.averageHandCarried = average(handCarried);
  out.personalAiShare = answered ? personal / answered : null;
  return out;
}

const sourceLabel = (s: string | null) => CLIENT_SOURCES.find((x) => x.value === s)?.label ?? "Not recorded";
const industryLabel = (s: string | null) => s?.trim() || "Not recorded";

// Grouped by a label, most readouts first, then by name.
function groupBy(rows: readonly AcrossInput[], label: (d: AcrossInput) => string): AcrossRow[] {
  const groups = new Map<string, AcrossInput[]>();
  for (const d of rows) {
    // Industries are typed, so "manufacturing" and "Manufacturing" are one.
    const key = label(d);
    const found = [...groups.keys()].find((k) => k.toLowerCase() === key.toLowerCase()) ?? key;
    groups.set(found, [...(groups.get(found) ?? []), d]);
  }
  return [...groups.entries()]
    .map(([k, v]) => acrossRow(k, v))
    .sort((a, b) => b.readouts - a.readouts || a.label.localeCompare(b.label));
}

export function acrossClients(rows: readonly AcrossInput[]) {
  return {
    all: acrossRow("Every client", rows),
    byIndustry: groupBy(rows, (d) => industryLabel(d.industry)),
    bySource: groupBy(rows, (d) => sourceLabel(d.source)),
  };
}
