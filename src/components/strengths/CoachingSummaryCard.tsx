import Link from "next/link";
import styles from "@/app/(app)/strengths/strengths.module.css";

type CoachingSummary = {
  hasConversation: boolean;
  exchangeCount: number;
  lastActivity: string | null;
  lastAssistantMessage: string | null;
};

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export default function CoachingSummaryCard({
  firstName,
  summary,
}: {
  firstName: string;
  summary: CoachingSummary;
}) {
  const relative = relativeTime(summary.lastActivity);
  const preview = summary.lastAssistantMessage?.trim();

  return (
    <section className={styles.card} aria-labelledby="coaching-summary">
      <div className={styles.cardHeader}>
        <h2 id="coaching-summary" className={styles.h2}>Your coach</h2>
        <span className={styles.cardHeaderMeta}>Private to you</span>
      </div>
      {summary.exchangeCount === 0 ? (
        <>
          <p className={styles.prose}>
            Talk anything through with your coach. What surprised you, what
            you want to build on, or where you&rsquo;d like to spend your energy.
            No admin can read it.
          </p>
          <Link href="/coach" className={styles.primaryButton}>
            Start a conversation
          </Link>
        </>
      ) : (
        <>
          <p className={styles.muted}>
            {summary.exchangeCount}{" "}
            {summary.exchangeCount === 1 ? "exchange" : "exchanges"} so far
            {relative ? ` · last activity ${relative}` : ""}.
          </p>
          {preview ? (
            <blockquote className={styles.evidence}>
              {preview.length > 240
                ? preview.slice(0, 240).trim() + "…"
                : preview}
            </blockquote>
          ) : null}
          <Link href="/coach" className={styles.primaryButton}>
            Continue the conversation
          </Link>
          <p className={styles.muted}>
            {firstName}, the thread stays open. Pick it up any time.
          </p>
        </>
      )}
    </section>
  );
}
