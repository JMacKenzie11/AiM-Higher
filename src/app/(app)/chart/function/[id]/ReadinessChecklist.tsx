import Link from "next/link";
import { CardAccent } from "@/components/ui/CardAccent";
import styles from "../../chart.module.css";

// The Role Description readiness card, as markup only.
//
// Two callers draw it: the detail page's server component, which
// computes the gates itself, and the chart drawer, which gets them
// over the wire. Neither owns the markup, so the card cannot drift
// into two versions of itself.
//
// `anchorGates` is the difference between them. On the page a
// pending gate links to "#roles", an id on a section further up the
// same document. In the drawer that section is a few centimetres
// above in the same panel and the anchor would jump the page behind
// it, so the drawer turns the links off.

export type ChecklistGate = {
  key: string;
  title: string;
  description: string;
  ready: boolean;
  href: string | null;
};

export function ReadinessChecklist({
  gates,
  readyCount,
  total,
  viewHref,
  hasBeenCreated,
  canEdit,
  anchorGates = true,
  headingId = "rd-readiness-heading",
}: {
  gates: ChecklistGate[];
  readyCount: number;
  total: number;
  viewHref: string;
  hasBeenCreated: boolean;
  canEdit: boolean;
  anchorGates?: boolean;
  headingId?: string;
}) {
  return (
    <section className={styles.rdReadinessCard} aria-labelledby={headingId}>
      <CardAccent />
      <div className={styles.rdReadinessHeaderNew}>
        <div>
          <h2 id={headingId} className={styles.rdReadinessTitle}>
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
            ) : anchorGates && g.href ? (
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
