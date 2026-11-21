import styles from "./dashboard.module.css";

// The week in review, shown whole. It used to type itself out on first
// view; that got in the way after a while, so it simply appears (Jason,
// 2026-11-21).

export type AiBriefProps = {
  content: string;
  generatedAt: string;
};

export function AiBrief({ content, generatedAt }: AiBriefProps) {
  return (
    <>
      <p className={styles.briefBody}>{content}</p>
      <span className={styles.briefTimestamp}>Refreshed {formatRelative(generatedAt)}</span>
    </>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMinutes = Math.max(0, Math.round((now - then) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
