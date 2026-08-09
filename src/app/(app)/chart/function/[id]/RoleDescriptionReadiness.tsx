import Link from "next/link";
import type { getChartFunctionDetail } from "@/lib/chart/service";
import { CardAccent } from "@/components/ui/CardAccent";
import { computeReadiness } from "@/lib/role-descriptions/readiness";
import { getCachedRoleDescription } from "@/lib/role-descriptions/cache";
import styles from "../../chart.module.css";

// Function-level readiness for the AiMS Role Description. Pure
// checklist + link; the actual editing happens inline on the
// section cards above (each has its own "Suggest options" popover
// when the RD feature is on). Reads gates from the shared helper
// so this card and the /role-description view route share one
// source of truth.
//
// Anchors match aria-labelledby ids on the page sections so a
// pending row can jump straight to where the fix lives.

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

export async function RoleDescriptionReadiness({
  detail,
  canEdit,
}: {
  detail: Detail;
  canEdit: boolean;
}) {
  const { gates, readyCount, total } = computeReadiness(detail);
  const viewHref = `/chart/function/${detail.fn.id}/role-description`;
  // "Created" here means a cached RD document exists for this
  // function. Once created, the button reads "View role
  // description →"; before that it reads "Create role
  // description →" for admins (who can trigger the initial
  // generation by visiting the view page). Team members without
  // a cached doc see no button.
  const cached = await getCachedRoleDescription(detail.fn.id);
  const hasBeenCreated = cached !== null;

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
            Fill in each section above. When all five are ready, the role
            description is ready to view.
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
        {hasBeenCreated ? (
          <Link href={viewHref} className={styles.rdReadinessAction}>
            View role description →
          </Link>
        ) : canEdit ? (
          <Link href={viewHref} className={styles.rdReadinessAction}>
            Create role description →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
