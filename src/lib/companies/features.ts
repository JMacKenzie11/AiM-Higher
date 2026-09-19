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
    hint: "Commitments, critical success factors, and the coaching dashboard.",
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
    // The hint said "requires a target on every KPI". There are no
    // KPIs since 0216 and a target has been optional since 0217, so
    // it described neither the feature nor the product.
    hint: "Weekly values against targets on Critical Success Factors, the dashboard card, and the Saturday sweep.",
    // ON FOR EVERY NEW COMPANY. Decided once the KPI collapse
    // landed: a critical success factor now IS the measurable thing,
    // so a company set up without this gets a page it can write a
    // list on and never record a number against. Every existing
    // company was switched on at the same time, so this is not a new
    // two-speed fleet, it is the end of one.
    defaultOnCreate: true,
  },
  {
    value: "external_measures",
    label: "External Measures",
    // "an external data source", not "the company's own spreadsheet".
    // A spreadsheet is the phase 1 connector, not the feature: phase
    // 3 adds HubSpot, and a flag hint that has to be rewritten every
    // time a connector lands was describing the wrong thing.
    hint: "Take a measure's weekly value from an external data source instead of typing it.",
  },
  {
    value: "meeting_facilitation_review",
    label: "Meeting Facilitation Review",
    hint: "After each meeting is analyzed, generate a coaching-tone review of how the meeting was run against the AiMS Weekly Leadership Meeting framework.",
  },
  {
    value: "automated_commitment_tracking",
    label: "Automated Commitment Tracking",
    hint: "Auto-create commitments from meeting transcripts.",
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
    hint: "Generate role descriptions for each function.",
  },
];

export const VALID_COMPANY_FEATURES = new Set(
  COMPANY_FEATURES.map((f) => f.value)
);
