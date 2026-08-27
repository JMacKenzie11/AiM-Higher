// Shared "done state" chip for the meeting-summary extraction
// sections. Green check + short label — same visual for a
// commitment that landed on a priority as for one that landed on
// a functional area or for an extracted issue that was added.
// Kept as a tiny plain-JSX component (no client hook) so it can
// render from either section without an unnecessary boundary.

import styles from "./extracted.module.css";

export function DoneChip({ label }: { label: string }) {
  return (
    <span className={styles.doneChip} aria-live="polite">
      <svg
        viewBox="0 0 16 16"
        width={14}
        height={14}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 8.5 L6.5 12 L13 4.5" />
      </svg>
      {label}
    </span>
  );
}
