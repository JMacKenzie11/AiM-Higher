// Barrel re-export. Actions live in per-entity files (sfa, goal,
// priority, cascade, bulk-reset) so each file stays focused; imports
// against @/lib/plan/actions still work.

export type { PlanResult } from "./_shared";

export {
  createSfaAction,
  updateSfaAction,
  updateSfaStatusAction,
  archiveSfaAction,
} from "./sfa-actions";

export {
  createGoalAction,
  updateGoalAction,
  updateGoalStatusAction,
  archiveGoalAction,
  setGoalSfaAction,
} from "./goal-actions";

export {
  createPriorityAction,
  updatePriorityAction,
  updatePriorityStatusAction,
  archivePriorityAction,
  setPriorityGoalAction,
} from "./priority-actions";

export {
  completePriorityAction,
  completeGoalAction,
  type CascadeResult,
} from "./cascade-actions";

export {
  bulkResetPlanAction,
  type BulkResetResult,
} from "./bulk-reset-action";
