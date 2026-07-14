import styles from "./ConfirmationChip.module.css";

// Small ephemeral chip surfaced by useStayOpenForm after a successful
// submit. Auto-dismissal is handled by the hook; this component just
// renders when visible.

export function ConfirmationChip({
  visible,
  label = "Added",
}: {
  visible: boolean;
  label?: string;
}) {
  if (!visible) return null;
  return (
    <span className={styles.chip} role="status" aria-live="polite">
      <span className={styles.check} aria-hidden="true">
        ✓
      </span>
      {label}
    </span>
  );
}
