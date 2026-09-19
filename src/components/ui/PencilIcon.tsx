import styles from "./ui.module.css";

// The edit affordance, as an icon rather than the word "Edit".
//
// Geometry matches PlusIcon and the row-action trash already in the
// app: a 16 viewBox drawn at 14px, 1.4 stroke, round caps and joins.
// Anything else reads as a different weight of line at the same size,
// which is what a second icon set looks like before anybody calls it
// one.
//
// aria-hidden because the button carries the label. A control reading
// "Edit this critical success factor" needs no second announcement of
// "pencil".
export function PencilIcon() {
  return (
    <svg
      className={styles.btnIcon}
      viewBox="0 0 16 16"
      width={14}
      height={14}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M11.2 2.6 a1.3 1.3 0 0 1 1.9 0 l0.3 0.3 a1.3 1.3 0 0 1 0 1.9 L6 12.2 l-2.6 0.7 0.7-2.6 z M10.1 3.7 l2.2 2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
