import styles from "./CardAccent.module.css";

// Two soft sky-tint circles pinned to the top-right of a card, giving
// statement / hero cards a bit of visual weight. Consumer card must
// have position:relative and overflow:hidden (otherwise the shapes
// escape the corner). Purely decorative — hidden from assistive tech.

export function CardAccent() {
  return (
    <>
      <span className={styles.large} aria-hidden="true" />
      <span className={styles.small} aria-hidden="true" />
    </>
  );
}
