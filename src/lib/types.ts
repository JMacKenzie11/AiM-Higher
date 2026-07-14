// Shared TypeScript types for domain rows the app reads/writes.
// These stay in one place so route handlers, server actions, and views
// agree on shape.

export type Role = "system_admin" | "company_admin" | "team_member";
export type ProfileStatus = "active" | "inactive";
export type CompanyStatus = "active" | "archived";
export type InvitationStatus = "pending" | "accepted" | "revoked";
export type QuarterStatus = "open" | "closed";

export type Profile = {
  id: string;
  company_id: string | null;
  full_name: string;
  position: string | null;
  role: Role;
  status: ProfileStatus;
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

export type Invitation = {
  id: string;
  company_id: string;
  email: string;
  full_name: string;
  position: string | null;
  role: Exclude<Role, "system_admin">;
  invited_by: string;
  token: string;
  status: InvitationStatus;
  expires_at: string;
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
export type CommitmentStatus = "open" | "kept" | "missed" | "carried";

export type Commitment = {
  id: string;
  company_id: string;
  priority_id: string;
  owner_id: string;
  description: string;
  week_ending: string;
  due_date: string;
  status: CommitmentStatus;
  completed_at: string | null;
  missed_reason: string | null;
  carried_from_id: string | null;
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

// ---- Foundation + marketing (Sections 4.6 + 4.7) -----------------
export type FoundationItemKind =
  | "core_value"
  | "vision_milestone"
  | "differentiator";

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
  vision_title: string | null;
  vision_tagline: string | null;
  vision_body: string | null;
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
