"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./plan.module.css";

export type QuarterOption = {
  id: string;
  label: string;
  status: "open" | "closed";
};

// Pill-row quarter selector. Preserves the current path (so it works
// on /plan and any other page that opts into the same selector) and
// only changes the `q` query parameter.

export function QuarterSwitcher({
  quarters,
  selectedId,
}: {
  quarters: QuarterOption[];
  selectedId: string | null;
}) {
  const pathname = usePathname() ?? "/plan";
  if (quarters.length === 0) return null;

  return (
    <div className={styles.quarterRow} role="tablist" aria-label="Quarter">
      {quarters.map((quarter) => {
        const isActive = quarter.id === selectedId;
        const href = `${pathname}?q=${quarter.id}`;
        return (
          <Link
            key={quarter.id}
            href={href}
            role="tab"
            aria-selected={isActive}
            className={
              isActive ? styles.quarterPillActive : styles.quarterPill
            }
          >
            <span>{quarter.label}</span>
            {quarter.status === "closed" ? (
              <span className={styles.closedTag}>Closed</span>
            ) : (
              <span className={styles.openTag}>Open</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
