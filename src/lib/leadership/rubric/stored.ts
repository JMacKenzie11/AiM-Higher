import type { RubricRun } from "./score-meeting";
import type { CheckSource, PartKey } from "./types";
import { isUnknownSpeaker } from "./turns";

// THE RUBRIC SCORE AS STORED, on meeting_analyses.facilitation_review_json
// under `rubric`. Everything the meeting page shows, plus every check's
// answer, so a later change to how checks make levels can re-score a
// meeting without asking the model again.
export type StoredCheck = {
  id: string;
  level: number;
  source: CheckSource;
  met: boolean;
  na: boolean;
  text: string;
  moment: string | null;
  agreed: number;
  runs: number;
};

export type StoredRubric = {
  version: number;
  total: number; // 10 to 50
  outOfTen: string; // "8.0"
  value: number; // 8.0, as a number
  parts: Array<{
    key: PartKey;
    name: string;
    level: number;
    wins: StoredCheck[];
    better: StoredCheck[];
  }>;
  checks: Array<StoredCheck & { part: PartKey }>;
  talk: {
    attendees: number;
    engaged: number;
    topShare: number;
    // Each identified person's share of the words spoken, largest first.
    speakers?: Array<{ name: string; share: number }>;
  };
  readings: number;
};

function check(r: StoredCheck): StoredCheck {
  return {
    id: r.id,
    level: r.level,
    source: r.source,
    met: r.met,
    na: r.na,
    text: r.text,
    moment: r.moment,
    agreed: r.agreed,
    runs: r.runs,
  };
}

export function toStoredRubric(run: RubricRun): StoredRubric {
  return {
    version: run.score.rubricVersion,
    total: run.score.total,
    outOfTen: run.score.outOfTen,
    value: run.score.total / 5,
    parts: run.score.parts.map((p) => ({
      key: p.key,
      name: p.name,
      level: p.level,
      wins: p.wins.map(check),
      better: p.better.map(check),
    })),
    checks: run.results.map((r) => ({ ...check(r), part: r.part })),
    talk: {
      attendees: run.counts.attendees,
      engaged: run.counts.engaged,
      topShare: Math.round(run.counts.topShare * 100) / 100,
      speakers: run.counts.speakers
        .filter((sp) => !isUnknownSpeaker(sp.name) && sp.share >= 0.01)
        .map((sp) => ({ name: sp.name, share: Math.round(sp.share * 100) / 100 })),
    },
    readings: run.readings,
  };
}

// A stored rubric, read defensively: the column is JSON and older rows
// have none.
export function readStoredRubric(raw: unknown): StoredRubric | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<StoredRubric>;
  if (typeof r.total !== "number" || !Array.isArray(r.parts) || r.parts.length === 0) return null;
  return r as StoredRubric;
}
