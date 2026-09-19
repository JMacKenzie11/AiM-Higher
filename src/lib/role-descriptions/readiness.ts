import "server-only";

import type { getChartFunctionDetail } from "@/lib/chart/service";

// Shared gate computation for the AiMS Role Description. The
// readiness card and the /role-description view both need to know
// what's ready and what isn't — pulling this into one place keeps
// them in sync. Callers pass in the already-loaded function detail.

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

export type ReadinessGate = {
  key: string;
  title: string;
  description: string;
  ready: boolean;
  href: string | null;
};

export type ReadinessResult = {
  gates: ReadinessGate[];
  readyCount: number;
  total: number;
  allReady: boolean;
};

export function computeReadiness(detail: Detail): ReadinessResult {
  const userRoleCount = detail.roles.filter((r) => !r.is_default).length;
  const outcomeCount = detail.outcomes.length;
  // "Each has at least one KPI under it" until 0216. With one level
  // the equivalent question is whether each factor is actually
  // measurable, which is whether it carries a target. A named factor
  // with no number is the row this gate exists to catch, and it still
  // catches it.
  const outcomesAllHaveTargets =
    outcomeCount > 0 &&
    detail.outcomes.every((o) => !!o.target && o.target.trim() !== "");

  const gates: ReadinessGate[] = [
    {
      key: "title",
      title: "Title",
      description: "Give the function a clear name.",
      ready: !!detail.fn.title.trim(),
      href: null,
    },
    {
      key: "responsibilities",
      title: "Responsibilities",
      description:
        "At least one responsibility beyond Lead / Track / Decide.",
      ready: userRoleCount >= 1,
      href: "#roles",
    },
    {
      key: "outcomes",
      title: "Critical success factors",
      description: "Three critical success factors, each with a target.",
      ready: outcomeCount >= 3 && outcomesAllHaveTargets,
      href: "#measures",
    },
    {
      key: "decision_rights",
      title: "Decision Rights",
      description:
        "At least one decision this seat can make without escalation.",
      ready: detail.decisionRights.length >= 1,
      href: "#decision-rights",
    },
    {
      key: "competencies",
      title: "Competency Indicators",
      description:
        "At least three observable behaviors that show excellence.",
      ready: detail.competencies.length >= 3,
      href: "#competencies",
    },
  ];
  const readyCount = gates.filter((g) => g.ready).length;
  const total = gates.length;
  return {
    gates,
    readyCount,
    total,
    allReady: readyCount === total,
  };
}
