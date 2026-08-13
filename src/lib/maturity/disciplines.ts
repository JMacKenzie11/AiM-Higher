// Registry for the AiMS Scorecard disciplines. One entry per
// discipline the /scorecard page can render, keyed by the same
// string used in company_discipline_snapshots.discipline.
//
// Adding a new discipline:
//   1. Extend the DiscplineKey union + DISCIPLINES array below.
//   2. Extend the CHECK constraint on company_discipline_snapshots
//      (new migration).
//   3. Add a scorer file at src/lib/maturity/scorers/<key>.ts
//      exporting a `score` function.
//   4. Wire it into src/lib/maturity/compute.ts.

export type DisciplineKey =
  | "foundation"
  | "chart"
  | "planning"
  | "execution"
  | "measures"
  | "meetings";

export type DisciplineConfig = {
  key: DisciplineKey;
  // Rendered as the card title on /scorecard.
  label: string;
  // One-line "why this matters" line used under the score.
  blurb: string;
  // Weight in the overall score average. Feature-gated disciplines
  // that are OFF for a company are dropped from the average — a
  // company without Success Tracking isn't dinged for not having it.
  weight: number;
  // If set, this discipline only scores when the company has the
  // named feature. When the feature is off, the scorecard shows a
  // muted "not enabled" tile in place of a number. The value must
  // match a `value` in COMPANY_FEATURES.
  feature?: string;
};

export const DISCIPLINES: readonly DisciplineConfig[] = [
  {
    key: "foundation",
    label: "Foundation",
    blurb: "Purpose, vision, values, differentiators — the strategic anchor everything else lines up to.",
    weight: 1,
  },
  {
    key: "chart",
    label: "Accountability chart",
    blurb: "Every function has a leader, an outcome, and something being measured.",
    weight: 1,
  },
  {
    key: "planning",
    label: "Strategic plan",
    blurb: "Focus areas → annual goals → quarterly actions, all populated in the open quarter.",
    weight: 2,
  },
  {
    key: "execution",
    label: "Execution",
    blurb: "Weekly commitments landing on time, linked to priorities, without piling up overdue.",
    weight: 2,
  },
  {
    key: "measures",
    label: "Success tracking",
    blurb: "Every measure has a target, gets logged weekly, and is trending on-track.",
    weight: 1,
    feature: "performance_tracking",
  },
  {
    key: "meetings",
    label: "Weekly leadership meeting",
    blurb: "Meetings happen weekly and are being run effectively.",
    weight: 1,
    feature: "meeting_facilitation_review",
  },
];

export const DISCIPLINE_KEYS: readonly DisciplineKey[] = DISCIPLINES.map(
  (d) => d.key
);

export function getDiscipline(key: DisciplineKey): DisciplineConfig {
  const found = DISCIPLINES.find((d) => d.key === key);
  if (!found) throw new Error(`Unknown discipline: ${key}`);
  return found;
}
