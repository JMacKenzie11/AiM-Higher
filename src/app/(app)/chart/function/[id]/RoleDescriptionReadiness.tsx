import Link from "next/link";
import type { getChartFunctionDetail } from "@/lib/chart/service";
import { CardAccent } from "@/components/ui/CardAccent";
import { computeReadiness } from "@/lib/role-descriptions/readiness";
import { CompleteRoleDescriptionButton } from "./CompleteRoleDescriptionButton";
import type { InitialGaps } from "./CompleteRoleDescriptionDrawer";
import styles from "../../chart.module.css";

// Function-level readiness for the AiMS Role Description. Renders
// only when the company has the role_descriptions feature on (the
// page decides that). Server component — reads the readiness gates
// from the shared helper so this card and the read-only view route
// share one source of truth.
//
// Anchors match the aria-labelledby ids on the page sections so a
// pending row can jump straight to where the fix lives without
// opening the drawer.

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

export function RoleDescriptionReadiness({
  detail,
  canEdit,
}: {
  detail: Detail;
  canEdit: boolean;
}) {
  const { gates, readyCount, total, allReady } = computeReadiness(detail);
  const viewHref = `/chart/function/${detail.fn.id}/role-description`;

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
        {canEdit || allReady ? (
          <Link href={viewHref} className={styles.rdSecondaryLink}>
            {allReady ? "View role description →" : "Preview so far →"}
          </Link>
        ) : null}
        {canEdit ? (
          <CompleteRoleDescriptionButton
            gaps={buildInitialGaps(detail)}
            allReady={allReady}
          />
        ) : null}
      </div>
    </section>
  );
}

// Build the gap descriptor the drawer walks. Mirrors the gates in
// computeReadiness; the drawer's step queue is derived from this
// so both the checklist and the interview stay in sync from the
// same source.
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
