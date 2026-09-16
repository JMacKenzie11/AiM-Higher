import styles from "./ui.module.css";

// The add affordance, as an icon rather than a character in the label.
//
// It used to be typed: "+ Add Goal", "+ Add goal", "+ Add a KPI" —
// three spellings of the same control across nine files, because a
// glyph inside a string cannot be sized, aligned or coloured apart
// from the words around it, so every author made their own call.
//
// Geometry matches the row-action icons already in the app: a 16
// viewBox drawn at 14px, 1.4 stroke, round caps. `.btnIcon` carries
// the half-pixel optical lift — a plus is visually centred lower than
// a capital letter beside it, so the arithmetic centre reads low.
//
// aria-hidden because the label says what the button does. A button
// reading "Add goal" needs no second announcement of "plus".
export function PlusIcon() {
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
        d="M8 3.5 v9 M3.5 8 h9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}
