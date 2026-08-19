import Link from "next/link";
import type { RecentActivityItem } from "@/lib/hq/service";
import styles from "./hq.module.css";

// Thin activity feed — 5 to 6 items — across the caller's caseload.
// No pagination, no filtering. Just a "what's changed lately" ambient
// signal. Meeting analyses and facilitation reviews both surface as
// separate rows so the guide can see both the fact of a meeting and
// the review that landed with it.

function formatWhen(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round((now - then) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function itemBody(item: RecentActivityItem) {
  switch (item.kind) {
    case "meeting_analyzed":
      return (
        <>
          Meeting analyzed:{" "}
          <Link
            className={styles.activityLink}
            href={`/leadership/meetings/${item.meetingId}`}
          >
            {item.title}
          </Link>
        </>
      );
    case "facilitation_review":
      if (item.insufficient) {
        return (
          <>
            Facilitation review landed — transcript wasn&rsquo;t scoreable.{" "}
            <Link
              className={styles.activityLink}
              href={`/leadership/meetings/${item.meetingId}`}
            >
              Open
            </Link>
          </>
        );
      }
      return (
        <>
          Facilitation review landed:{" "}
          {item.overall === null ? "no score" : `${item.overall}/10`}.{" "}
          <Link
            className={styles.activityLink}
            href={`/leadership/meetings/${item.meetingId}`}
          >
            Open
          </Link>
        </>
      );
    case "quarter_opened":
      return <>New quarter opened: {item.quarterLabel}</>;
    case "quarter_closed":
      return <>Quarter closed: {item.quarterLabel}</>;
  }
}

export function RecentActivitySection({
  items,
}: {
  items: RecentActivityItem[];
}) {
  return (
    <section className={styles.card} aria-labelledby="hq-activity">
      <h2 id="hq-activity" className={styles.h2}>
        Recent activity
      </h2>
      {items.length === 0 ? (
        <p className={styles.empty}>Nothing notable this month.</p>
      ) : (
        <ul className={styles.activityList}>
          {items.map((item, i) => (
            <li key={i} className={styles.activityItem}>
              <span className={styles.activityWhen}>{formatWhen(item.when)}</span>
              <div className={styles.activityMain}>
                <span className={styles.activityCompany}>{item.companyName}</span>
                <span className={styles.activityText}>{itemBody(item)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
