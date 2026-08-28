// Shared TypeScript types for domain rows the app reads/writes.
// These stay in one place so route handlers, server actions, and views
// agree on shape.

export type Role =
  | "system_admin"
  | "company_admin"
  | "team_member"
  | "aims_guide";

// A single (guide -> company) assignment. Guides have no primary
// company_id on their profile; their access is derived from these
// rows via the is_guide_for() SQL helper.
export type GuideAssignment = {
  guide_id: string;
  company_id: string;
  created_at: string;
};
export type ProfileStatus = "pending" | "active" | "inactive";
export type CompanyStatus = "active" | "archived";
export type QuarterStatus = "open" | "closed";
export type UserStrengthKind = "strength" | "superpower";

export type Profile = {
  id: string;
  company_id: string | null;
  // full_name is trigger-maintained from first_name + last_name
  // (migration 0017). Reads keep working everywhere; writes to
  // either side stay in sync automatically.
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  hire_date: string | null; // ISO date YYYY-MM-DD
  position_start_date: string | null;
  reports_to: string | null; // profile FK, lays groundwork for org chart
  position: string | null;
  avatar_url: string | null;
  role: Role;
  status: ProfileStatus;
  invited_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Company = {
  id: string;
  name: string;
  timezone: string;
  industry: string | null;
  status: CompanyStatus;
  created_at: string;
  updated_at: string;
  // Soft-delete timestamp (migration 0148). Non-null rows are
  // hidden from every SELECT via the companies_hide_deleted RLS
  // policy, so app-facing queries will never see them — the column
  // is here for typing completeness when we do explicitly load
  // rows via the service role (e.g. backups).
  deleted_at: string | null;
};

export type UserStrength = {
  id: string;
  user_id: string;
  kind: UserStrengthKind;
  label: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Quarter = {
  id: string;
  company_id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: QuarterStatus;
  created_at: string;
  updated_at: string;
};

// ---- cascade ----------------------------------------------------
export type CascadeStatus =
  | "not_started"
  | "on_track"
  | "behind"
  | "complete"
  | "ongoing";

export type StrategicFocusArea = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  sponsor_id: string | null;
  status: CascadeStatus;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type AnnualGoal = {
  id: string;
  company_id: string;
  sfa_id: string | null;
  title: string;
  description: string | null;
  owner_id: string | null;
  target_date: string | null;
  status: CascadeStatus;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type Priority = {
  id: string;
  company_id: string;
  annual_goal_id: string | null;
  quarter_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_date: string | null;
  status: CascadeStatus;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

// ---- commitments ------------------------------------------------
// Resolution model (as of migration 0139):
//   open          — still to do.
//   kept_on_time  — resolved on/before the due date.
//   kept_late     — resolved after the due date. Same "did it" signal,
//                   distinct display (check + clock badge, never X or
//                   red), NOT counted in the Follow-Through numerator.
//   missed        — not done.
// The old `in_progress` and `kept` values are retired; `in_progress`
// collapses into `open`, `kept` becomes `kept_on_time`.
export type CommitmentStatus =
  | "open"
  | "kept_on_time"
  | "kept_late"
  | "missed";

// Roles allowed to resolve a commitment, recorded on the row so
// downstream (coaching context, scoring) can distinguish "no reason
// given by owner" from "resolved by admin in the meeting."
export type CommitmentResolverRole = "owner" | "admin" | "guide";

export type Commitment = {
  id: string;
  company_id: string;
  // null = operational (not tied to a strategic priority). Only strategic
  // commitments feed priority progress; every non-issue flavor counts
  // identically toward keep rate.
  //
  // Link taxonomy (unified per migration 0143). A commitment has AT
  // MOST ONE of priority_id / issue_id / functional_area_id. Zero =
  // operational; one = strategic (priority), Solution Seeking
  // (issue), or functional-area work. The DB check constraint
  // enforces exclusivity; the app surfaces route based on which
  // link is set. Issue-linked commitments do NOT appear on the
  // company-wide /commitments page (they live on Issues/Solutions),
  // but they remain included in every person-scoped surface
  // (scorecard, Guide HQ my commitments, coaching context,
  // follow-through math).
  priority_id: string | null;
  issue_id: string | null;
  functional_area_id: string | null;
  // null = unassigned. Extraction from meeting transcripts may create
  // a commitment without a matched roster owner; a company_admin
  // reassigns, or a team member claims it for themselves via the
  // dedicated action.
  owner_id: string | null;
  description: string;
  week_ending: string;
  due_date: string;
  status: CommitmentStatus;
  completed_at: string | null;
  missed_reason: string | null;
  carried_from_id: string | null;
  // Set when this row was created by the meeting-transcript analysis
  // pipeline. Null for hand-entered commitments.
  source_meeting_id: string | null;
  // Clarity assessment — two booleans that answer "is this
  // commitment clear enough to keep?". Null means "unassessed" (a
  // different state from an explicit false). The analyzer may
  // populate these on extraction; the owner or an admin can
  // override at any time via the row's clarity strip.
  clarity_timeline: boolean | null;
  clarity_success: boolean | null;
  clarity_note: string | null;
  // Soft-delete: filtered from every UI + metric. Retention only for
  // future coaching-signal work — see migration 0139 rationale.
  deleted_at: string | null;
  // Parking lot: excluded from weekly flow, overdue logic, and
  // Follow-Through. Bring-back nulls this and sets a fresh due_date.
  parked_at: string | null;
  // Repeating weekly commitment. Per-week resolutions live in
  // commitment_occurrences; the commitments row itself stays 'open'
  // and rolls its due_date forward on each resolution.
  is_ongoing: boolean;
  // Populated at resolution time; null for open rows.
  resolved_by_role: CommitmentResolverRole | null;
  resolved_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

// ---- Issues / Solution Seeking (migration 0143) ----------------
// A named problem, tension, or unresolved question. Carries a
// desired_outcome ("what we want") and hosts issue-linked
// commitments (the "way / who-by-when"). Ranks manually within
// its company; rank order is shared across users, not per-user.
// Resolves; never hard-deletes. Historical open commitments stay
// live when the parent issue resolves.
export type IssueStatus = "open" | "resolved";

export type Issue = {
  id: string;
  company_id: string;
  title: string;
  desired_outcome: string | null;
  status: IssueStatus;
  rank: number;
  // Set when the issue was created via the meeting-summary
  // "Add to open issues" action. Null for hand-entered issues.
  source_meeting_id: string | null;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Per-week resolution row for ongoing commitments (migration 0140).
// One row per (commitment_id, week_ending). Non-ongoing commitments
// don't produce these — their single resolution lives on the
// commitments row itself.
export type CommitmentOccurrence = {
  id: string;
  commitment_id: string;
  week_ending: string;
  status: "kept_on_time" | "kept_late" | "missed";
  missed_reason: string | null;
  resolved_at: string;
  resolved_by_profile_id: string | null;
  resolved_by_role: CommitmentResolverRole | null;
  created_at: string;
};

// ---- derived-progress views -------------------------------------
export type PriorityProgressRow = {
  priority_id: string;
  company_id: string;
  status: CascadeStatus;
  archived: boolean;
  kept_count: number;
  open_count: number;
  missed_count: number;
  carried_count: number;
  denominator: number;
  percent: number | null;
};

export type AnnualGoalProgressRow = {
  annual_goal_id: string;
  company_id: string;
  status: CascadeStatus;
  archived: boolean;
  percent: number | null;
};

export type SfaProgressRow = {
  sfa_id: string;
  company_id: string;
  status: CascadeStatus;
  archived: boolean;
  percent: number | null;
};

// ---- Functional scorecard (Section 4.8) -------------------------
export type MetricValueType = "number" | "percent" | "text";

export type FunctionalArea = {
  id: string;
  company_id: string;
  name: string;
  accountable_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ScorecardMetric = {
  id: string;
  company_id: string;
  functional_area_id: string;
  name: string;
  target: string | null;
  value_type: MetricValueType;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type ScorecardEntry = {
  id: string;
  company_id: string;
  metric_id: string;
  week_ending: string;
  value_number: number | null;
  value_text: string | null;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
};

// ---- Chart (Functions → Outcomes → Success Measures) ------------
// Replaces the older Scorecard model. Functions form a tree via
// parent_function_id. Each function owns Outcomes; each outcome owns
// Success Measures; each measure has weekly entries.
export type FunctionNode = {
  id: string;
  company_id: string;
  parent_function_id: string | null;
  title: string;
  description: string | null;
  // LTD (Lead / Track / Decide). Historically stored as leader_id;
  // migration 0020 renamed → lead_id and added the other two roles.
  // Track and Decide are nullable — the UI falls back to Lead.
  lead_id: string | null;
  track_id: string | null;
  decide_id: string | null;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type FunctionOutcome = {
  id: string;
  function_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

// Roles & Responsibilities under a function. Every function has one
// row with is_default=true holding "Lead, Track, Decide" — the
// baseline responsibility of any seat holder. That row can't be
// edited or deleted (enforced by RLS + the UI).
export type FunctionRole = {
  id: string;
  function_id: string;
  title: string;
  body: string | null;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

// Independent decisions the seat holder can make without escalation.
// Feeds the Role Description generator's Decision Rights section and
// shows on /chart/function/[id] when the company has the
// role_descriptions feature on. No default row.
export type FunctionDecisionRight = {
  id: string;
  function_id: string;
  title: string;
  body: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// Observable behaviors / measurable standards that indicate what
// excellence looks like in the seat. Feeds the Role Description
// generator's Competency Indicators (Development Framework) section.
// No default row. RD interview recommends 3–5 when generating.
export type FunctionCompetency = {
  id: string;
  function_id: string;
  title: string;
  body: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type TargetDirection = "higher_is_better" | "lower_is_better";

export type SuccessMeasure = {
  id: string;
  outcome_id: string;
  description: string;
  target: string | null;
  value_type: MetricValueType;
  // Direction determines what "at or above target" means. Higher-is-
  // better (revenue, on-time %) sees a value >= target as good;
  // lower-is-better (defect rate, incident count) flips the comparison.
  target_direction: TargetDirection;
  // Opt-out for context measures (headcount, cash on hand) that are
  // worth tracking but shouldn't fire "you didn't update" commitments.
  auto_track: boolean;
  // Short AI-generated coaching hint about the target. Populated
  // when Performance Tracking is on and the model thinks the target
  // could be sharper (vague, not time-bound, not measurable, or
  // direction doesn't match the wording). Null when the target
  // passes or hasn't been scored yet.
  target_hint: string | null;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type SuccessMeasureEntry = {
  id: string;
  measure_id: string;
  week_ending: string;
  value_number: number | null;
  value_text: string | null;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
};

// ---- Foundation + marketing (Sections 4.6 + 4.7) -----------------
export type FoundationItemKind =
  | "core_value"
  | "differentiator"
  | "key_success_metric";

export type MarketingSnippetKind =
  | "short_hook"
  | "long_hook"
  | "website_copy"
  | "avoid"
  | "icp_best_fit"
  | "icp_psychographic"
  | "elevated_phrase";

export type CompanyFoundation = {
  company_id: string;
  purpose_statement: string | null;
  purpose_context: string | null;
  // Consolidated in migration 0106 — vision is a single field now.
  // Legacy vision_title, vision_tagline, and vision_milestone items
  // were merged into it.
  vision: string | null;
  created_at: string;
  updated_at: string;
};

export type FoundationItem = {
  id: string;
  company_id: string;
  kind: FoundationItemKind;
  title: string;
  body: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type MarketingStrategy = {
  company_id: string;
  positioning_statement: string | null;
  executive_summary: string | null;
  anchoring_message: string | null;
  created_at: string;
  updated_at: string;
};

export type MessagingPillar = {
  id: string;
  company_id: string;
  name: string;
  message: string | null;
  language_bank: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type MarketingSnippet = {
  id: string;
  company_id: string;
  kind: MarketingSnippetKind;
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// ---- Meeting transcripts (Section: ingestion pipeline) ----------
export type TranscriptSourceScope = "company" | "shared";
export type TranscriptProviderKind = "google_drive" | "teams";
export type TranscriptSourceStatus = "active" | "paused" | "error";

export type TranscriptSource = {
  id: string;
  company_id: string | null;
  scope: TranscriptSourceScope;
  provider: TranscriptProviderKind;
  folder_id: string;
  folder_name: string | null;
  cursor: string | null;
  status: TranscriptSourceStatus;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type TranscriptAlias = {
  id: string;
  company_id: string;
  alias: string;
  created_at: string;
  updated_at: string;
};

export type MeetingStatus =
  | "unrouted"
  | "pending"
  | "analyzing"
  | "complete"
  | "failed";

export type Meeting = {
  id: string;
  company_id: string | null;
  source_id: string;
  provider_file_id: string;
  file_name: string;
  content_hash: string;
  routed_by_alias: string | null;
  meeting_title: string | null;
  transcript_text: string;
  status: MeetingStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
};

// Shape of the extraction call's parsed JSON — validated server-side
// before rows are created.
// Extracted issue from the transcript. Never auto-created — the
// meeting summary surfaces each with an "Add to open issues"
// action that creates an issues row on demand (title only,
// desired_outcome + commitments left empty for the team to work
// live). Cap 8 per meeting; titles under 200 characters.
export type ExtractedIssue = {
  title: string;
};

export type ExtractedCommitment = {
  owner_profile_id: string | null;
  description: string;
  due_date: string | null;
  priority_id: string | null;
  // Clarity scoring: analyzer's assessment of whether the
  // commitment as spoken meets each of the two AiMS criteria,
  // plus an optional short refinement suggestion when any is false.
  // Optional because raw model output may omit them; validation
  // coerces missing/unexpected values to null so the DB stores
  // "unassessed" rather than a spurious explicit false.
  clarity_timeline?: boolean | null;
  clarity_success?: boolean | null;
  clarity_note?: string | null;
};

export type OAuthCredentials = {
  id: string;
  company_id: string;
  provider: TranscriptProviderKind;
  account_email: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MeetingAnalysis = {
  id: string;
  meeting_id: string;
  analysis_markdown: string;
  commitments_json: ExtractedCommitment[];
  // Second array on the extraction pipeline (migration 0144).
  // Null when the extraction pre-dated the issues rollout OR the
  // model returned no issues for that meeting. Empty array means
  // the model ran and emitted zero. Both cases render the same
  // in the UI (no Issues Identified section).
  issues_json: ExtractedIssue[] | null;
  // Structured facilitation review (see FacilitationReview in
  // src/lib/leadership/facilitation/types.ts). Null when the
  // meeting_facilitation_review feature is off or the second pass
  // failed. Rendered by the FacilitationReview component.
  facilitation_review_json: unknown | null;
  model: string;
  created_at: string;
};
