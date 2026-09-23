// Shapes shared between the push, the panel and the receipts.
// No imports, so the panel (a client component) can use them.

export type DistributionOutcome =
  | "applied"
  | "already_current"
  | "refused"
  | "failed"
  | "retracted";

// What the dry run says WOULD happen, and what the apply reports
// actually happened. Deliberately the same shape: the apply executes
// the plan the dry run showed, and a reader comparing the two should
// not have to translate between them.
export type DistributionStep = {
  subdomain: string;
  displayName: string;
  outcome: DistributionOutcome;
  // One line a human reads. Never "ok" — what changed, or why not.
  detail: string;
  fromVersion: number | null;
  toVersion: number | null;
  // True of the target, and worth knowing BEFORE the push rather
  // than discovering after it.
  warnings: string[];
};

export type DistributionPlan = {
  agentSlug: string;
  versionNumber: number | null;
  steps: DistributionStep[];
  // False when nothing can be pushed: no live version to send.
  pushable: boolean;
  // Why not, when it is false.
  blockedReason: string | null;
};

export type DistributionStatus =
  | "current"
  | "behind"
  | "never"
  | "refused"
  | "failed"
  | "retracted";

export type InstanceDistributionRow = {
  subdomain: string;
  displayName: string;
  status: DistributionStatus;
  distributedVersion: number | null;
  lastPushedAt: string | null;
  lastOutcome: DistributionOutcome | null;
  lastDetail: string;
};
