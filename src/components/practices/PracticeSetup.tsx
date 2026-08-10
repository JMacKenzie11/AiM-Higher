"use client";

import type { Practice } from "@/lib/practices/registry";
import styles from "./practice.module.css";

// Empty-state setup shown at the top of a fresh practice conversation.
// Renders the practice header + description and the opening chips.
// Chip click hands the label back to ChatView, which sends it as the
// first user message. The composer stays below (owned by ChatView).

export function PracticeSetup({
  practice,
  onSendChip,
  disabled,
}: {
  practice: Practice;
  onSendChip: (chip: string) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.setup}>
      <div>
        <p className={styles.setupEyebrow}>Practice</p>
        <h2 className={styles.setupTitle}>{practice.title}</h2>
        <p className={styles.setupDescription}>{practice.description}</p>
      </div>

      {practice.chips && practice.chips.length > 0 ? (
        <div className={styles.setupField}>
          <span className={styles.setupLabel}>Start with</span>
          <div className={styles.setupChipRow}>
            {practice.chips.map((chip) => (
              <button
                key={chip}
                type="button"
                className={styles.setupChip}
                onClick={() => onSendChip(chip)}
                disabled={disabled}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
