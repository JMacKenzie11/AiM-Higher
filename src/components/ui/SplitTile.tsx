import type { ReactNode } from "react";
import styles from "./SplitTile.module.css";

// The Scoreboard split tile (Jason, 2026-11-21): a navy panel holding
// what the card is (eyebrow, title, a line of context, sometimes a big
// number) beside its content on white. First made for the week in
// review; used wherever a card is a heading over a read.
//
//   stacked   the navy panel sits on top instead of beside, for cards
//             in a grid and for long reads that need the full width.
//             Every tile stacks on a phone.

export type SplitTileProps = {
  id: string;
  title: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  // Under the title in the panel: a headline number, a chip.
  aside?: ReactNode;
  // Pinned to the foot of the panel: "Refreshed 7 min ago", a link.
  footer?: ReactNode;
  stacked?: boolean;
  as?: "section" | "article";
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

export function SplitTile({
  id,
  title,
  eyebrow,
  meta,
  aside,
  footer,
  stacked,
  as = "section",
  className,
  bodyClassName,
  children,
}: SplitTileProps) {
  const Tag = as;
  return (
    <Tag
      className={[styles.tile, stacked ? styles.stacked : "", className ?? ""].filter(Boolean).join(" ")}
      aria-labelledby={id}
    >
      <div className={styles.side}>
        {eyebrow ? (
          <p className={styles.eyebrow}>
            <span className={styles.dot} aria-hidden="true" />
            {eyebrow}
          </p>
        ) : null}
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {meta ? <p className={styles.meta}>{meta}</p> : null}
        {aside ? <div className={styles.aside}>{aside}</div> : null}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
      <div className={[styles.body, bodyClassName ?? ""].filter(Boolean).join(" ")}>{children}</div>
    </Tag>
  );
}

// A big number for the panel, with its label under it. With no number
// yet (null), a short line in its place rather than a dash.
export function SplitTileStat({
  value,
  label,
  empty = "Not yet",
}: {
  value: ReactNode | null;
  label: ReactNode;
  empty?: string;
}) {
  return (
    <div className={styles.stat}>
      {value === null ? (
        <span className={styles.statEmpty}>{empty}</span>
      ) : (
        <span className={`${styles.statValue} aims-tabular`}>{value}</span>
      )}
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
