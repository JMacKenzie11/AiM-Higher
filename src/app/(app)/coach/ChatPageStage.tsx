import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./coach.module.css";

// A conversation's page (Ask Aimee, or coaching about a person): no
// page header, a back link, then the conversation card, whose navy
// title band says what the conversation is (Jason, 2026-11-23, option A
// of the conversation mockup). A big header above a chat pushed the
// conversation down the screen and said the same thing twice.
export function ChatPageStage({
  backHref,
  backLabel,
  children,
}: {
  backHref: string;
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.chatStage}>
      <Link href={backHref} className={styles.chatBack}>
        ← {backLabel}
      </Link>
      {children}
    </div>
  );
}
