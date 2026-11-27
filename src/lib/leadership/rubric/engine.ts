import type {
  CheckAnswer,
  CheckInput,
  CheckResult,
  PartScore,
  RubricScore,
} from "./types";
import { RUBRIC, RUBRIC_VERSION, SUPPORTING_CHECKS } from "./rubric";

// FROM CHECKS TO A SCORE. Pure arithmetic: no model, no judgement.
//
// A part's level is the highest level whose checks, and every check
// below it, were all met. Level 1 needs nothing. So a part can never
// read 4 while a level-3 check is open, and the checks shown under a
// score always explain it.
//
// The total is the ten levels added up, out of 50, and the score out
// of 10 is that divided by 5 (the rubric's own rule). Integers all the
// way: 40 / 5 is "8.0", never 7.999.

// One reading of the meeting, every check answered.
export function answerChecks(input: CheckInput): Record<string, CheckAnswer & { moment: string | null }> {
  const out: Record<string, CheckAnswer & { moment: string | null }> = {};
  for (const part of RUBRIC) {
    for (const check of part.checks) {
      if (check.kind === "derived") {
        out[check.id] = { ...check.answer(input), moment: null };
      } else {
        const j = input.obs.judged[check.id];
        out[check.id] = { met: j?.met === true, moment: j?.moment ?? null };
      }
    }
  }
  return out;
}

// SEVERAL READINGS, ONE ANSWER PER CHECK. Each check takes the answer
// most readings gave; a tie is not met, because a check that only
// half the readings could support is not yet shown to have happened.
// The count of readings that agreed is kept, so the eval can find the
// questions the model answers unevenly.
export function mergeReadings(
  readings: Array<Record<string, CheckAnswer & { moment: string | null }>>
): CheckResult[] {
  const runs = readings.length;
  const results: CheckResult[] = [];
  for (const part of RUBRIC) {
    for (const check of part.checks) {
      const answers = readings.map((r) => r[check.id]).filter(Boolean);
      const yes = answers.filter((a) => a.met).length;
      const met = runs > 0 && yes * 2 > runs;
      // The detail and moment come from a reading that gave the
      // winning answer, so a "not met" never carries a met reading's
      // "5 of 5".
      const pick = answers.find((a) => a.met === met) ?? answers[0];
      const na = answers.length > 0 && answers.every((a) => a.na === true);
      const text = (met ? check.well : check.better).replace("{detail}", pick?.detail ?? "");
      results.push({
        id: check.id,
        part: part.key,
        level: check.level,
        source: check.source,
        met,
        na,
        text: tidy(text),
        moment: met ? (pick?.moment ?? null) : null,
        agreed: met ? yes : runs - yes,
        runs,
      });
    }
  }
  return results;
}

// "({detail})" with no detail leaves "()" behind.
function tidy(text: string): string {
  return text.replace(/\s*\(\s*\)/g, "").replace(/\(\s*this week\)/g, "").replace(/\s{2,}/g, " ").trim();
}

export function partLevel(results: CheckResult[]): number {
  let level = 1;
  for (const l of [2, 3, 4, 5] as const) {
    const at = results.filter((r) => r.level === l);
    if (at.every((r) => r.met)) level = l;
    else break;
  }
  return level;
}

export function scoreRubric(results: CheckResult[]): RubricScore {
  const parts: PartScore[] = RUBRIC.map((part) => {
    const own = results.filter((r) => r.part === part.key);
    // A supporting check feeds a derived check and is scored only
    // through it. Gating a level on it too counted it twice, and a
    // fallback question nobody needed could hold a part at 1 with
    // every shown check met (the second eval, 2026-11-27).
    const level = partLevel(own.filter((r) => !SUPPORTING_CHECKS.has(r.id)));
    const shown = own.filter((r) => !SUPPORTING_CHECKS.has(r.id) && !r.na);
    // What would take it higher: the open checks at the next level up,
    // the step the team can actually take next week. Higher levels
    // wait their turn, so the list stays short.
    const nextLevel = level + 1;
    return {
      key: part.key,
      name: part.name,
      level,
      wins: shown.filter((r) => r.met),
      better: shown.filter((r) => !r.met && r.level === nextLevel),
    };
  });
  const total = parts.reduce((sum, p) => sum + p.level, 0);
  return {
    rubricVersion: RUBRIC_VERSION,
    parts,
    total,
    outOfTen: `${Math.floor((total * 2) / 10)}.${(total * 2) % 10}`,
    split: results.filter((r) => r.runs > 1 && r.agreed < r.runs).map((r) => r.id),
  };
}
