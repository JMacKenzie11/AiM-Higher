import type { getChartFunctionDetail } from "@/lib/chart/service";
import { CardAccent } from "@/components/ui/CardAccent";
import { CompleteRoleDescriptionButton } from "./CompleteRoleDescriptionButton";
import type { InitialGaps } from "./CompleteRoleDescriptionDrawer";
import styles from "../../chart.module.css";

// Function-level readiness for the AiMS Role Description. Renders
// only when the company has the role_descriptions feature on (the
// page decides that). Server component — computes gate state and
// hands it to CompleteRoleDescriptionButton, which owns the drawer
// that walks the missing sections. Visual pattern mirrors the
// dashboard SetupChecklist card so the two "you're setting this up"
// surfaces feel like the same platform gesture.
//
// Gates (v1 — kept minimal, iterate from feedback):
//   1. Title           — always ✓ (enforced at function creation)
//   2. Responsibilities — ≥1 non-default row in function_roles
//   3. Success Measures — ≥3 outcomes AND every outcome has ≥1 metric
//   4. Decision Rights  — ≥1 row in function_decision_rights
//   5. Competency Indicators — ≥3 rows in function_competencies
//
// Anchors match the aria-labelledby ids on the page sections so a
// pending row can jump straight to where the fix lives without
// opening the drawer.

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

type Gate = {
  key: string;
  title: string;
  description: string;
  ready: boolean;
  href: string | null;
};

export function RoleDescriptionReadiness({ detail }: { detail: Detail }) {
  const userRoleCount = detail.roles.filter((r) => !r.is_default).length;
  const outcomeCount = detail.outcomes.length;
  const outcomesAllHaveMetrics =
    outcomeCount > 0 && detail.outcomes.every((o) => o.measures.length >= 1);

  const gates: Gate[] = [
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
      title: "Success Measures",
      description:
        "Three measurable outcomes, each with at least one metric.",
      ready: outcomeCount >= 3 && outcomesAllHaveMetrics,
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
  const allReady = readyCount === total;

  return (
    <section
      className={styles.rdReadinessCard}
      aria-labelledby="rd-readiness-heading"
    >
      <CardAccent />
      <div className={styles.rdReadinessHeaderNew}>
        <div>
          <h2 id="rd-readiness-heading" className={styles.rdReadinessTitle}>
            Role Description
          </h2>
          <p className={styles.rdReadinessSubtitle}>
            A short walk to a publishable role description. Sections check
            off as you complete each one.
          </p>
        </div>
        <div className={styles.rdProgressBadge} aria-hidden="true">
          {readyCount} of {total}
        </div>
      </div>

      <ol className={styles.rdItemList}>
        {gates.map((g, i) => (
          <li
            key={g.key}
            className={styles.rdItem}
            data-done={g.ready ? "true" : undefined}
          >
            <div className={styles.rdItemBadge} aria-hidden="true">
              {g.ready ? (
                <svg viewBox="0 0 16 16" width={14} height={14}>
                  <path
                    d="M3.5 8.5 L6.5 11.5 L12.5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span>{i + 1}</span>
              )}
            </div>
            <div className={styles.rdItemBody}>
              <div className={styles.rdItemTitle}>{g.title}</div>
              <div className={styles.rdItemDescription}>{g.description}</div>
            </div>
            {g.ready ? (
              <span className={styles.rdItemDoneLabel}>Done</span>
            ) : g.href ? (
              <a href={g.href} className={styles.rdItemLink}>
                Open →
              </a>
            ) : (
              <span className={styles.rdItemDoneLabel}>—</span>
            )}
          </li>
        ))}
      </ol>

      <div className={styles.rdReadinessFooter}>
        <CompleteRoleDescriptionButton
          gaps={buildInitialGaps(detail)}
          allReady={allReady}
        />
      </div>
    </section>
  );
}

// Build the gap descriptor the drawer walks. Mirrors the gates
// above; the drawer's step queue is derived from this so both the
// checklist and the interview stay in sync from the same source.
function buildInitialGaps(detail: Detail): InitialGaps {
  const userRoleCount = detail.roles.filter((r) => !r.is_default).length;
  return {
    functionId: detail.fn.id,
    companyId: detail.fn.company_id,
    responsibilities: { count: userRoleCount, needed: 1 },
    outcomes: { count: detail.outcomes.length, needed: 3 },
    measuresNeededFor: detail.outcomes
      .filter((o) => o.measures.length === 0)
      .map((o) => ({ outcomeId: o.id, outcomeTitle: o.title })),
    decisionRights: { count: detail.decisionRights.length, needed: 1 },
    competencies: { count: detail.competencies.length, needed: 3 },
  };
}
