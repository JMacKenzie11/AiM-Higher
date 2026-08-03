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
  status: CompanyStatus;
  created_at: string;
  updated_at: string;
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
// Open = still to do. Kept = closed on/before due date. Missed = closed
// after due date (labelled "Closed" in the UI — an opportunity to
// improve). The prior "carried" state was removed in migration 0011.
export type CommitmentStatus = "open" | "kept" | "missed";

export type Commitment = {
  id: string;
  company_id: string;
  // null = operational (not tied to a strategic priority). Only strategic
  // commitments feed priority progress; both flavors count identically
  // toward keep rate.
  priority_id: string | null;
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
  // Clarity assessment — three booleans that answer "is this
  // commitment clear enough to keep?". Null means "unassessed" (a
  // different state from an explicit false). The analyzer may
  // populate these on extraction; the owner or an admin can
  // override at any time via the row's clarity strip.
  clarity_deliverable: boolean | null;
  clarity_timeline: boolean | null;
  clarity_success: boolean | null;
  clarity_note: string | null;
  created_at: string;
  updated_at: string;
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
  entered_by: string;
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

export type SuccessMeasure = {
  id: string;
  outcome_id: string;
  description: string;
  target: string | null;
  value_type: MetricValueType;
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
  entered_by: string;
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
export type ExtractedCommitment = {
  owner_profile_id: string | null;
  description: string;
  due_date: string | null;
  priority_id: string | null;
  // Clarity scoring: analyzer's assessment of whether the
  // commitment as spoken meets each of the three AiMS criteria,
  // plus an optional short refinement suggestion when any is false.
  // Optional because raw model output may omit them; validation
  // coerces missing/unexpected values to null so the DB stores
  // "unassessed" rather than a spurious explicit false.
  clarity_deliverable?: boolean | null;
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
  model: string;
  created_at: string;
};
