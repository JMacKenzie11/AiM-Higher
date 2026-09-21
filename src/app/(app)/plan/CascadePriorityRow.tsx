import Link from "next/link";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import type { CascadePriority } from "@/lib/plan/service";
import { orphanReason, orphanReasonLabel } from "@/lib/plan/orphan-reason";
import styles from "./plan.module.css";

// One quarterly priority row in the /plan cascade.
//
// Extracted because there are now THREE places a priority renders on
// this page: under a goal, under a focus area directly (migration
// 0209), and in the standalone section at the bottom. Three copies of
// the same markup is how the owner line and the open-commitment count
// drift apart on two of them.
//
// `trailing` is for controls that belong to one context only — the
// link picker on a standalone row, which the other two don't have.
//
// `explainOrphan` is only ever true in the standalone section, and
// only says something when the row GOT there rather than started
// there. Under a goal or a focus area the parent is right above it
// and the question does not arise.
export function CascadePriorityRow({
  priority,
  trailing,
  explainOrphan = false,
}: {
  priority: CascadePriority;
  trailing?: React.ReactNode;
  explainOrphan?: boolean;
}) {
  const orphanLabel = explainOrphan
    ? orphanReasonLabel(orphanReason(priority))
    : null;
  return (
    <li className={styles.priorityItem}>
      <div className={styles.summaryMain}>
        {/* Wrapped, because .summaryMain is a flex COLUMN — two
            pills dropped straight into it stack, which reads as two
            unrelated labels rather than one qualifying the other. */}
        <span className={styles.rowLabels}>
          <span className={styles.levelLabel}>Quarterly Priority</span>
          {orphanLabel ? (
            <span className={styles.orphanReasonChip}>{orphanLabel}</span>
          ) : null}
        </span>
        <Link
          href={`/plan/priority/${priority.id}`}
          className={styles.priorityTitle}
        >
          {priority.title}
        </Link>
        <span className={styles.rowMeta}>
          {priority.owner?.full_name ?? "Unassigned"}
          {priority.due_date ? ` · Due ${priority.due_date}` : ""}
          {" · "}
          {openCommitmentsLabel(priority.open_count)}
        </span>
      </div>
      <div className={styles.summaryEnd}>
        <StatusChip status={priority.status} />
        <ProgressBar percent={priority.percent} label="No commitments yet" />
        {trailing}
      </div>
    </li>
  );
}

// Counts what is LEFT to do, not what has been done — the bar beside
// it already says how much is done, which is why a priority can read
// "1 open commitment" and 50% at the same time.
export function openCommitmentsLabel(openCount: number): string {
  if (openCount === 0) return "no open commitments";
  return `${openCount} open commitment${openCount === 1 ? "" : "s"}`;
}
