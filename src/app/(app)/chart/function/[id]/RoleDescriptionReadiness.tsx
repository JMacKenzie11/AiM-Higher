import type { getChartFunctionDetail } from "@/lib/chart/service";
import { CompleteRoleDescriptionButton } from "./CompleteRoleDescriptionButton";
import type { InitialGaps } from "./CompleteRoleDescriptionDrawer";
import styles from "../../chart.module.css";

// Function-level readiness for the AiMS Role Description. Renders
// only when the company has the role_descriptions feature on (the
// page decides that). Server component — computes gate state and
// hands it to CompleteRoleDescriptionButton, which owns the drawer
// that walks the missing sections.
//
// Gates (v1 — kept minimal, iterate from feedback):
//   1. Title           — always ✓ (enforced at function creation)
//   2. Responsibilities — ≥1 non-default row in function_roles
//   3. Success Measures — ≥3 outcomes AND every outcome has ≥1 metric
//   4. Decision Rights  — ≥1 row in function_decision_rights
//   5. Competency Indicators — ≥3 rows in function_competencies
//
// Anchors match the aria-labelledby ids on the page sections so a
// missing-gate row can jump straight to where the fix lives.

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

type Gate = {
  key: string;
  label: string;
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
      label: "Title set",
      ready: !!detail.fn.title.trim(),
      href: null,
    },
    {
      key: "responsibilities",
      label: "At least one responsibility beyond L/T/D",
      ready: userRoleCount >= 1,
      href: "#roles",
    },
    {
      key: "outcomes",
      label: "Three Success Measures, each with a metric",
      ready: outcomeCount >= 3 && outcomesAllHaveMetrics,
      href: "#measures",
    },
    {
      key: "decision_rights",
      label: "At least one Decision Right",
      ready: detail.decisionRights.length >= 1,
      href: "#decision-rights",
    },
    {
      key: "competencies",
      label: "At least three Competency Indicators",
      ready: detail.competencies.length >= 3,
      href: "#competencies",
    },
  ];

  const readyCount = gates.filter((g) => g.ready).length;
  const total = gates.length;
  const allReady = readyCount === total;

  return (
    <section
      className={styles.rdReadiness}
      aria-labelledby="rd-readiness-heading"
    >
      <div className={styles.rdReadinessHeader}>
        <div>
          <h2 id="rd-readiness-heading" className={styles.rdReadinessTitle}>
            Role Description
          </h2>
          <p
            className={
              allReady ? styles.rdReadinessReady : styles.rdReadinessProgress
            }
          >
            {allReady
              ? "Ready to generate"
              : `${readyCount} of ${total} sections ready`}
          </p>
        </div>
        <CompleteRoleDescriptionButton
          gaps={buildInitialGaps(detail)}
          allReady={allReady}
        />
      </div>

      <ul className={styles.rdChecklist}>
        {gates.map((g) => (
          <li key={g.key} className={styles.rdChecklistRow}>
            <span
              aria-hidden
              className={
                g.ready ? styles.rdCheckReady : styles.rdCheckMissing
              }
            >
              {g.ready ? "✓" : "○"}
            </span>
            {g.href && !g.ready ? (
              <a href={g.href} className={styles.rdChecklistLink}>
                {g.label}
              </a>
            ) : (
              <span
                className={
                  g.ready
                    ? styles.rdChecklistLabelReady
                    : styles.rdChecklistLabel
                }
              >
                {g.label}
              </span>
            )}
          </li>
        ))}
      </ul>
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

