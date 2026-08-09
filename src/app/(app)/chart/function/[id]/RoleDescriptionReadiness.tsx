import type { getChartFunctionDetail } from "@/lib/chart/service";
import styles from "../../chart.module.css";

// Function-level readiness for the AiMS Role Description. Renders
// only when the company has the role_descriptions feature on (the
// page decides that). Server component — no interactivity yet.
// When the interview and draft/publish surface land, the strip's
// right-side action grows into "Complete interview" / "Preview" /
// "Publish" depending on state.
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
        <button
          type="button"
          className={styles.rdReadinessAction}
          disabled
          title="Interview and preview coming soon."
        >
          {allReady ? "Generate role description" : "Complete interview"}
        </button>
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
