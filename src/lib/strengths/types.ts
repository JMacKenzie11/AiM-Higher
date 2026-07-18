// Strengths Map domain types. `Role`, `Profile`, and the invite
// status live in `src/lib/types.ts` (unified in merger Phase 2);
// this file keeps only assessment- and scoring-specific shapes.

export type Dimension = "thinking" | "influence" | "execution" | "relating";
export type ItemType = "competence" | "energy" | "orientation";
export type AssessmentStatus = "in_progress" | "completed";

export interface Item {
  id: string;
  dimension: Dimension;
  sub_strength: string;
  item_type: ItemType;
  text: string;
  text_b: string | null;
  direct_side: "A" | "B" | null;
  legacy_tags: string[] | null;
  sort_order: number;
}

export interface Response {
  item_id: string;
  value: number;
  answered_at?: string;
}

export type Flag =
  | "signature"
  | "capable_but_draining"
  | "hidden_pull"
  | "lower_priority";

export interface SubStrengthResult {
  sub_strength: string;
  dimension: Dimension;
  competence: number;
  energy: number;
  flag: Flag;
  narrative_evidence: string | null;
}

export interface DimensionResult {
  dimension: Dimension;
  competence_avg: number;
  energy_avg: number;
}

export interface ResultsProfile {
  dimensions: DimensionResult[];
  sub_strengths: SubStrengthResult[];
  orientation: {
    lean: "direct" | "balanced" | "facilitative";
    score: number;
    by_dimension: Record<string, number>;
  };
  top_strengths: string[];
  divergences: { sub_strength: string; note: string }[];
  narrative_coded: string[];
}

export const SUB_STRENGTH_LABELS: Record<string, string> = {
  ideation: "Ideation",
  problem_solving: "Problem Solving",
  analysis: "Analysis",
  foresight: "Foresight",
  judgment: "Judgment",
  mobilizing: "Mobilizing",
  communication: "Communication",
  direction: "Direction",
  connecting: "Connecting",
  follow_through: "Follow-Through",
  organizing: "Organizing",
  ownership: "Ownership",
  developing_others: "Developing Others",
  empathy: "Empathy",
  building_trust: "Building Trust",
  including: "Including",
};

export const DIMENSION_LABELS: Record<Dimension, string> = {
  thinking: "Thinking",
  influence: "Influence",
  execution: "Execution",
  relating: "Relating",
};

export const FLAG_LABELS: Record<Flag, string> = {
  signature: "Signature strength",
  capable_but_draining: "Capable but draining",
  hidden_pull: "Emerging pull",
  lower_priority: "Energy better spent elsewhere",
};

export const LIKERT_LABELS = [
  "Strongly Disagree",
  "Disagree",
  "Neutral",
  "Agree",
  "Strongly Agree",
] as const;

export const ORIENTATION_INTENSITY = [
  "Strongly", // 1 or 4 depending on side
  "Lean",
  "Lean",
  "Strongly",
] as const;
