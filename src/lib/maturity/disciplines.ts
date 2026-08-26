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
  | "meetings"
  | "solution_seeking"
  | "positive_framing";

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
  // Long-form "what does this mean, and how is it scored?" text shown
  // in the card's info tooltip. Keep to 1–3 sentences — designed for
  // hover, not deep reading.
  scoringNote: string;
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
    scoringNote:
      "Two points each for: purpose statement, vision, ≥3 core values, ≥3 differentiators, ≥3 key success metrics. Max 10. State-based — either the surfaces are filled in or not, so no trend arrow.",
  },
  {
    key: "chart",
    label: "Accountability chart",
    blurb: "Every function has a leader, an outcome, and something being measured.",
    weight: 1,
    href: "/chart",
    hrefLabel: "Open the chart",
    showsTrend: false,
    scoringNote:
      "Per function: 5 pts if there's a Lead, 3 pts if there's at least one outcome, 2 pts if there's at least one measure. Averaged across all non-archived functions. Also state-based.",
  },
  {
    key: "planning",
    label: "Strategic plan",
    blurb: "Cascade populated in the open quarter, and annual goals + quarterly priorities closing by their due dates.",
    weight: 2,
    href: "/plan",
    hrefLabel: "Open the plan",
    showsTrend: true,
    scoringNote:
      "Populated cascade (SFAs + goals + priorities) is a 2-pt baseline. Annual-goal closure by target date = up to 4 pts. Priority closure by due date = up to 4 pts. Nothing past due yet ⇒ full credit on the closure halves so a fresh plan isn't dragged down.",
  },
  {
    key: "execution",
    label: "Execution",
    blurb: "Weekly commitments landing on time and not piling up past due.",
    weight: 2,
    href: "/commitments",
    hrefLabel: "Open commitments",
    showsTrend: true,
    scoringNote:
      "Follow-through rate (kept ÷ resolved) over the last 30 days = up to 7 pts. Aging opens (>14 days past due) cost 0.5 pt each, up to 3 pts of penalty. Priority linkage is deliberately not scored — operational floaters are by design.",
  },
  {
    key: "measures",
    label: "Success tracking",
    blurb: "Every measure has a target, gets logged weekly, and is trending on-track.",
    weight: 1,
    feature: "performance_tracking",
    href: "/measures",
    hrefLabel: "Open key success measures",
    showsTrend: true,
    scoringNote:
      "% of measures with a target set (3 pts) + % logged in the last 7 days (5 pts) + penalty for auto-track measures missing this week (2 pts). Only scored when Success Tracking is enabled.",
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
    scoringNote:
      "Cadence: distinct weeks in the last 8 with ≥1 meeting = up to 5 pts. Quality: mean facilitation-review overall score across meetings in the window, mapped to 5 pts. Only scored when Meeting Facilitation Review is enabled.",
  },
  {
    key: "solution_seeking",
    label: "Solution seeking",
    blurb: "Issues raised in leadership meetings work through the AiMS 4Ws — clear what, want, way forward, and who by when.",
    weight: 1,
    feature: "meeting_facilitation_review",
    href: "/leadership",
    hrefLabel: "Open meetings",
    showsTrend: true,
    scoringNote:
      "Aggregates the 4Ws audit across every issue in every reviewed meeting in the last 8 weeks. Score = (Ws closed ÷ Ws total) × 10. No issues surfaced ⇒ not scored (won't drag the average).",
  },
  {
    key: "positive_framing",
    label: "Appreciative practice",
    blurb: "Meetings celebrate wins, reframe problems as opportunities, and ask generative questions — the appreciative-inquiry stance AiMS is built on.",
    weight: 1,
    feature: "meeting_facilitation_review",
    href: "/leadership",
    hrefLabel: "Open meetings",
    showsTrend: true,
    scoringNote:
      "Mean of the facilitation review's positive_framing dimension across meetings in the last 8 weeks. The evidence also counts observed appreciation moments, generative questions, and reframes. Not scored until the v2 review has run at least once.",
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
