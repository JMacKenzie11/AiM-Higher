// Where each row of the plan cascade RENDERS.
//
// Pure, and separate from the queries, because the rules are subtle
// enough to be worth stating once and testing directly:
//
//   1. A goal renders under its focus area. A priority renders under
//      its goal, or under its focus area if it has no goal.
//   2. Goals and direct priorities are PEERS under a focus area,
//      not two tiers — `sfa_progress` averages them one-each, so a
//      layout that nested one inside the other would contradict the
//      percentage shown above it.
//   3. A row whose parent is NOT ON SCREEN is an orphan. Archived
//      parents are the case that matters: archive a focus area from
//      its detail page and its goals used to render nowhere and
//      bucket nowhere, which reads as data loss rather than as an
//      archive. "Standalone" means nowhere to put it, not "no parent
//      column set".

type HasId = { id: string };
type GoalLike = HasId & { sfa_id: string | null };
type PriorityLike = HasId & {
  annual_goal_id: string | null;
  sfa_id: string | null;
};

export type CascadeBuckets<G extends GoalLike, P extends PriorityLike> = {
  goalsBySfa: Map<string, G[]>;
  prioritiesByGoal: Map<string, P[]>;
  prioritiesBySfa: Map<string, P[]>;
  orphanGoals: G[];
  orphanPriorities: P[];
};

export function bucketCascadeChildren<
  S extends HasId,
  G extends GoalLike,
  P extends PriorityLike,
>(sfas: S[], goals: G[], priorities: P[]): CascadeBuckets<G, P> {
  const visibleSfaIds = new Set(sfas.map((row) => row.id));
  const visibleGoalIds = new Set(goals.map((row) => row.id));

  const goalsBySfa = new Map<string, G[]>();
  const orphanGoals: G[] = [];
  for (const goal of goals) {
    if (goal.sfa_id && visibleSfaIds.has(goal.sfa_id)) {
      push(goalsBySfa, goal.sfa_id, goal);
    } else {
      orphanGoals.push(goal);
    }
  }

  const prioritiesByGoal = new Map<string, P[]>();
  const prioritiesBySfa = new Map<string, P[]>();
  const orphanPriorities: P[] = [];
  for (const priority of priorities) {
    // Goal wins if both are somehow set. The database refuses that
    // pair (`priorities_parent_exclusive`), so this is about a stale
    // object in memory rather than a row — and the point of checking
    // in order is that such a row renders ONCE rather than twice.
    if (priority.annual_goal_id) {
      if (visibleGoalIds.has(priority.annual_goal_id)) {
        push(prioritiesByGoal, priority.annual_goal_id, priority);
      } else {
        orphanPriorities.push(priority);
      }
      continue;
    }
    if (priority.sfa_id) {
      if (visibleSfaIds.has(priority.sfa_id)) {
        push(prioritiesBySfa, priority.sfa_id, priority);
      } else {
        orphanPriorities.push(priority);
      }
      continue;
    }
    orphanPriorities.push(priority);
  }

  return {
    goalsBySfa,
    prioritiesByGoal,
    prioritiesBySfa,
    orphanGoals,
    orphanPriorities,
  };
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
