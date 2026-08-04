"use client";

import { useId, useState } from "react";
import styles from "./marketing.module.css";

// Accessible accordion. Uses native details/summary semantics
// underneath via aria-expanded on the trigger so keyboard nav is
// stock; only one item is open at a time to keep the section
// scannable.

export type FaqItem = { question: string; answer: React.ReactNode };

export function Faq({ items }: { items: FaqItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const groupId = useId();
  return (
    <ul className={styles.faqList}>
      {items.map((item, i) => {
        const isOpen = openIdx === i;
        const panelId = `${groupId}-panel-${i}`;
        const triggerId = `${groupId}-trigger-${i}`;
        return (
          <li key={i} className={styles.faqItem}>
            <button
              type="button"
              id={triggerId}
              aria-controls={panelId}
              aria-expanded={isOpen}
              className={styles.faqTrigger}
              onClick={() => setOpenIdx(isOpen ? null : i)}
            >
              <span>{item.question}</span>
              <span className={styles.faqChevron} aria-hidden="true">
                {isOpen ? "–" : "+"}
              </span>
            </button>
            {isOpen ? (
              <div
                id={panelId}
                role="region"
                aria-labelledby={triggerId}
                className={styles.faqAnswer}
              >
                {item.answer}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
