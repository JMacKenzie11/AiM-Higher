// Shape of the persisted facilitation review. Stored as JSONB on
// meeting_analyses.facilitation_review_json. The DB is intentionally
// schemaless — this type is the single source of truth; iterating on
// the prompt doesn't require a migration as long as the shape holds.
//
// If the shape needs a breaking change, bump prompt.vN.md AND add a
// `version` sentinel below so old rows can be rendered by the right
// legacy adapter. v1 is the initial cut.

export const FACILITATION_REVIEW_VERSION = 1;

export type FacilitationDimension = "rhythm" | "accountability" | "alignment";

export type FacilitationStrength = {
  title: string;
  evidence: string;
};

export type FacilitationGrowthEdge = {
  dimension: FacilitationDimension;
  title: string;
  evidence: string;
  why_it_matters: string;
};

export type FacilitationExperiment = {
  action: string;
  why: string;
  next_step: string;
};

// One row per issue the meeting worked through. `note` is optional
// coaching text on the 4Ws step that didn't land — depersonalized,
// future-facing, never critical of a person.
export type FacilitationFourWsRow = {
  issue: string;
  has_what: boolean;
  has_want: boolean;
  has_way: boolean;
  has_who_when: boolean;
  note?: string | null;
};

export type FacilitationDimensionScore = {
  score: number | null; // 0–10; null when insufficient_transcript
  notes: string;
};

export type FacilitationReview = {
  version: number;
  insufficient_transcript: boolean;
  missing_context?: string | null;
  // Overall 0–10 read. Null when insufficient_transcript is true.
  overall: number | null;
  // 1-sentence read to sit at the top of the UI.
  executive_summary: string;
  strengths: FacilitationStrength[];
  growth_edges: FacilitationGrowthEdge[];
  experiments: FacilitationExperiment[];
  fourws_audit: FacilitationFourWsRow[];
  dimensions: {
    rhythm: FacilitationDimensionScore;
    accountability: FacilitationDimensionScore;
    alignment: FacilitationDimensionScore;
  };
  agenda_adherence: {
    score_out_of_5: number | null;
    notes: string;
  };
};
