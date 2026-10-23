"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import styles from "./plan.module.css";

export type QuarterOption = {
  id: string;
  label: string;
  status: "open" | "closed";
};

// Pill-row quarter selector. Preserves the current path and the rest
// of its query (so it works on /plan, in the weekly meeting's Strategy
// step, and on any other page that opts into the same selector) and
// only changes the `q` query parameter.

export function QuarterSwitcher({
  quarters,
  selectedId,
}: {
  quarters: QuarterOption[];
  selectedId: string | null;
}) {
  const pathname = usePathname() ?? "/plan";
  const params = useSearchParams();
  if (quarters.length === 0) return null;

  return (
    <div className={styles.quarterRow} role="tablist" aria-label="Quarter">
      {quarters.map((quarter) => {
        const isActive = quarter.id === selectedId;
        const next = new URLSearchParams(params?.toString() ?? "");
        next.set("q", quarter.id);
        const href = `${pathname}?${next.toString()}`;
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
