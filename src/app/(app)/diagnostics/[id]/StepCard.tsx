import type { ReactNode } from "react";
import styles from "../diagnostics.module.css";

// One step's card: the tinted header with its title, a count, and the
// step's main action top right; the content; Back and Next at the foot.
export function StepCard({
  id,
  title,
  meta,
  action,
  footer,
  children,
}: {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.card} aria-labelledby={id}>
      <div className={styles.cardHeader}>
        <h2 id={id} className={styles.cardTitle}>
          {title}
        </h2>
        {meta !== undefined && meta !== null ? <span className={styles.cardMeta}>{meta}</span> : null}
        {action ? <span className={styles.headerAction}>{action}</span> : null}
      </div>
      {children}
      {footer ? <div className={styles.cardFooter}>{footer}</div> : null}
    </section>
  );
}
