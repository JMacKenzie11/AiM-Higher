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
  // Where the card should send the user to actually work on this
  // discipline. Rendered as a "Go to X →" affordance on the card.
  href: string;
  // Copy for the drill-down link. Kept beside href so a designer can
  // tune the wording without hunting through JSX.
  hrefLabel: string;
  // Whether the card carries a trend chip + sparkline. State-based
  // disciplines (foundation, accountability chart) are essentially
  // done-or-not, so a "vs 90 days ago" arrow just adds noise. The
  // behaviorally-rolling ones (planning closure, execution, measures,
  // meetings) do benefit from the arc.
  showsTrend: boolean;
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
    href: "/foundation",
    hrefLabel: "Open the One-Page Plan",
    showsTrend: false,
  },
  {
    key: "chart",
    label: "Accountability chart",
    blurb: "Every function has a leader, an outcome, and something being measured.",
    weight: 1,
    href: "/chart",
    hrefLabel: "Open the chart",
    showsTrend: false,
  },
  {
    key: "planning",
    label: "Strategic plan",
    blurb: "Cascade populated in the open quarter, and annual goals + quarterly priorities closing by their due dates.",
    weight: 2,
    href: "/plan",
    hrefLabel: "Open the plan",
    showsTrend: true,
  },
  {
    key: "execution",
    label: "Execution",
    blurb: "Weekly commitments landing on time and not piling up past due.",
    weight: 2,
    href: "/commitments",
    hrefLabel: "Open commitments",
    showsTrend: true,
  },
  {
    key: "measures",
    label: "Success tracking",
    blurb: "Every measure has a target, gets logged weekly, and is trending on-track.",
    weight: 1,
    feature: "performance_tracking",
    href: "/measures",
    hrefLabel: "Open success measures",
    showsTrend: true,
  },
  {
    key: "meetings",
    label: "Weekly leadership meeting",
    blurb: "Meetings happen weekly and are being run effectively.",
    weight: 1,
    feature: "meeting_facilitation_review",
    href: "/leadership",
    hrefLabel: "Open meetings",
    showsTrend: true,
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
