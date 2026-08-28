import Link from "next/link";
import styles from "./ask-aimee-tabs.module.css";

// Two-tab switcher on /ask-aimee. Server component — the current tab
// is read from the URL search param upstream and passed in, and each
// pill is a plain Link, so no client state is needed. Kept local to
// /ask-aimee because it doesn't need to be generic yet.

export type AskAimeeTab = "ask" | "coaches";

export function AskAimeeTabs({ active }: { active: AskAimeeTab }) {
  return (
    <div className={styles.row} role="tablist" aria-label="Ask Aimee sections">
      <Link
        href="/ask-aimee"
        role="tab"
        aria-selected={active === "ask"}
        className={active === "ask" ? styles.pillActive : styles.pill}
      >
        Ask Aimee
      </Link>
      <Link
        href="/ask-aimee?tab=coaches"
        role="tab"
        aria-selected={active === "coaches"}
        className={active === "coaches" ? styles.pillActive : styles.pill}
      >
        Practice Coaches
      </Link>
    </div>
  );
}
