// Single source of truth for the company-level feature catalog.
// Consumed by the create form, the settings edit form, and the
// server-side validator in actions.ts so a new feature only has to
// be added in one place.

export type CompanyFeature = {
  value: string;
  label: string;
  hint: string;
  defaultOnCreate?: boolean;
  // hidden
  //   Kept in the catalog and out of the pickers. The flag stays
  //   valid, stays enforced, and companies that already carry it are
  //   untouched; it simply stops being offered while what it gates
  //   is being replaced.
  //
  //   NOT deleted, deliberately. Removing the entry would drop it
  //   from VALID_COMPANY_FEATURES, and the settings form submits the
  //   full set of ticked boxes — so the first save on any company
  //   that had it would silently strip it.
  hidden?: boolean;
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
    // WHAT THIS FLAG IS, AND WHAT IT STOPPED BEING.
    //
    // It used to gate the tracking surface itself: the week columns
    // on /measures, the Target field on the measure form, the 13-week
    // board, the scorecard discipline. A company without it got a
    // page it could write a list on and never record a number
    // against, which is not a product decision anybody made — it was
    // the KPI-era gate outliving the KPIs.
    //
    // Recording a number is now part of the page, for everyone. What
    // is left, and all this flag means, is whether the system acts on
    // those numbers WITHOUT being asked:
    //
    //   the Friday nudge for a measure you lead and have not logged
    //   an Issue raised from a below-target entry     (Saturday cron)
    //   a commitment raised for an actual nobody entered  (same cron)
    //
    // OFF BY DEFAULT, and off across the fleet as of 2026-09-19: none
    // of those three is in use with any company yet, and a flag that
    // is on before the behaviour it governs is wanted only creates
    // work nobody asked for.
    hint: "Chase missing weekly values and act on them automatically: a Friday nudge, an Issue raised from a below-target entry, and a commitment raised for an actual nobody entered. Logging values does not need this.",
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
    // Hidden 2026-09-22. The Role Description Creator replaced the
    // authoring half of what this gates, and what becomes of the
    // decision-rights and competency columns is a later decision.
    // Offering a toggle for a half-replaced feature invites somebody
    // to switch it on and meet both halves.
    value: "role_descriptions",
    label: "Role Descriptions",
    hint: "Generate role descriptions for each function.",
    hidden: true,
  },
];

export const VALID_COMPANY_FEATURES = new Set(
  COMPANY_FEATURES.map((f) => f.value)
);
