"use client";

import { useState } from "react";
import type { CommitmentPriorWeek } from "@/lib/commitments/service";
import type { Priority, Profile } from "@/lib/types";
import { CommitmentRow } from "./CommitmentRow";
import styles from "./commitments.module.css";

// One collapsed prior-week summary. Clicking expands to reveal the
// week's resolved rows. Open rows from prior weeks live in the pinned
// Needs Attention group above, so an expanded prior-week list is
// resolved-only by definition. Linkage stays frozen (would rewrite
// priority history); status flips (Kept ↔ Open, Closed ↔ Open) are
// allowed for owner or admin, any week.

export type PriorWeekRowProps = {
  week: CommitmentPriorWeek;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  todayIso: string;
  currentUserId: string;
  isAdmin: boolean;
  currentUserCompanyId: string | null;
};

export function PriorWeekRow({
  week,
  priorityOptions,
  roster,
  todayIso,
  currentUserId,
  isAdmin,
  currentUserCompanyId,
}: PriorWeekRowProps) {
  const [open, setOpen] = useState(false);
  const bar = week.keepRate ?? 0;

  return (
    <div>
      <button
        type="button"
        className={styles.summaryRow}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className={styles.summaryLabel}>Week of {week.weekRange}</span>
        <span className={styles.summaryCounts}>
          {week.keptCount} kept · {week.missedCount} closed ·{" "}
          {week.keepRate === null ? "—" : `${week.keepRate}%`}
        </span>
        <span className={styles.summaryBar} aria-hidden>
          <span
            className={styles.summaryBarFill}
            style={{ width: `${Math.min(100, Math.max(0, bar))}%` }}
          />
        </span>
      </button>

      {open ? (
        <ul className={`${styles.rowList} ${styles.summaryExpandedList}`}>
          {week.commitments.length === 0 ? (
            <li className={styles.emptyLine}>
              Nothing matches these filters in this week.
            </li>
          ) : (
            (() => {
              const renderRow = (commitment: typeof week.commitments[number]) => {
                const canResolve =
                  isAdmin ||
                  commitment.owner_id === currentUserId ||
                  commitment.company_id === currentUserCompanyId;
                return (
                  <CommitmentRow
                    key={commitment.id}
                    commitment={commitment}
                    priorityOptions={priorityOptions}
                    roster={roster}
                    todayIso={todayIso}
                    canResolve={canResolve}
                    canLink={false}
                    canReassign={canResolve}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                  />
                );
              };
              const assigned = week.commitments.filter((c) => c.owner_id !== null);
              const unassigned = week.commitments.filter((c) => c.owner_id === null);
              return (
                <>
                  {assigned.map(renderRow)}
                  {unassigned.length > 0 ? (
                    <li className={styles.unassignedHeading}>Unassigned</li>
                  ) : null}
                  {unassigned.map(renderRow)}
                </>
              );
            })()
          )}
        </ul>
      ) : null}
    </div>
  );
}
