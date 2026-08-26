"use client";

import { useState } from "react";
import type { ResolvedIssueSummary } from "@/lib/issues/service";
import { formatShortDate } from "@/lib/dates";
import styles from "./issues.module.css";

// Collapsed-by-default list of resolved issues. Read-only; expand
// to see title + date + commitment count.

export function ResolvedIssuesList({
  items,
}: {
  items: ResolvedIssueSummary[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.resolvedSection}>
      <button
        type="button"
        className={styles.resolvedToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Resolved issues ({items.length})
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <ul className={styles.resolvedList}>
          {items.map((i) => (
            <li key={i.id} className={styles.resolvedRow}>
              <span className={styles.resolvedTitle}>{i.title}</span>
              <span className={styles.resolvedMeta}>
                {i.resolved_at ? formatShortDate(i.resolved_at) : "—"} ·{" "}
                {i.commitment_count}{" "}
                {i.commitment_count === 1 ? "commitment" : "commitments"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
