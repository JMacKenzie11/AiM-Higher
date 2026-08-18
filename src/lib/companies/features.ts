// Single source of truth for the company-level feature catalog.
// Consumed by the create form, the settings edit form, and the
// server-side validator in actions.ts so a new feature only has to
// be added in one place.

export type CompanyFeature = {
  value: string;
  label: string;
  hint: string;
  defaultOnCreate?: boolean;
};

export const COMPANY_FEATURES: ReadonlyArray<CompanyFeature> = [
  {
    value: "execution",
    label: "Execution Platform",
    hint: "Commitments, success measures, and the coaching dashboard.",
    defaultOnCreate: true,
  },
  {
    value: "strengths",
    label: "Strengths",
    hint: "Team strengths assessments, results, and strengths-aware coaching.",
  },
  {
    value: "performance_tracking",
    label: "Success Tracking",
    hint: "Requires targets on every success measure and turns on weekly performance nudges.",
  },
  {
    value: "meeting_facilitation_review",
    label: "Meeting Facilitation Review",
    hint: "After each meeting is analyzed, generate a coaching-tone review of how the meeting was run against the AiMS Weekly Leadership Meeting framework.",
  },
  {
    value: "automated_commitment_tracking",
    label: "Automated Commitment Tracking",
    hint: "When on, commitments extracted from meeting transcripts are automatically created as rows on the Commitments page. Turn off if the team wants to author commitments manually — the meeting summary and facilitation review still run either way.",
    defaultOnCreate: true,
  },
  {
    value: "classroom",
    label: "Classroom",
    hint: "Adds a shared training library — lessons, videos, and downloadable resources authored centrally by AiMS. Aimee can also recommend a training in conversation.",
  },
  {
    value: "role_descriptions",
    label: "Role Descriptions",
    hint: "Guides users through a one-question-at-a-time interview on each Function to fill in outcomes, success measures, decision rights, and competency indicators, then renders a publishable AiMS role description.",
  },
];

export const VALID_COMPANY_FEATURES = new Set(
  COMPANY_FEATURES.map((f) => f.value)
);
