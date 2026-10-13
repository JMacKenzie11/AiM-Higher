import type { FacilitationReview } from "@/lib/leadership/facilitation/types";

// A free meeting analysis for a prospect (migration 0265). Fully
// separate from client data: no company row, no roster, no meeting.

export type LeadAnalysisStatus = "pending" | "analyzing" | "complete" | "failed";

// A commitment as the lead pipeline extracts it. A client meeting's
// commitment names its owner by profile id from the roster; a
// prospect has no roster, so the owner is the name as the transcript
// gives it. The two clarity tests are the same ones (clarity-rules.ts).
export type LeadCommitment = {
  owner: string | null;
  description: string;
  due_phrase: string | null;
  clarity_timeline: boolean;
  clarity_success: boolean;
  clarity_note: string | null;
  needs_rewording?: boolean;
};

export type LeadIssue = { title: string; needs_rewording?: boolean };

export type LeadAnalysisRow = {
  id: string;
  full_name: string;
  email: string;
  company_name: string;
  role_title: string | null;
  file_name: string | null;
  transcript_text: string;
  status: LeadAnalysisStatus;
  error: string | null;
  analysis_markdown: string | null;
  truncated: boolean;
  commitments_json: LeadCommitment[];
  issues_json: LeadIssue[];
  facilitation_review_json: FacilitationReview | null;
  score_positive_framing: number | null;
  score_rhythm: number | null;
  score_accountability: number | null;
  score_alignment: number | null;
  score_agenda: number | null;
  score_overall: number | null;
  score_weights: unknown;
  model: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
};

// The list page reads these and nothing heavier.
export const LEAD_LIST_COLUMNS =
  "id, full_name, email, company_name, role_title, status, score_overall, created_at" as const;

export type LeadListRow = Pick<
  LeadAnalysisRow,
  "id" | "full_name" | "email" | "company_name" | "role_title" | "status" | "score_overall" | "created_at"
>;
