import styles from "./ViaAssistantBadge.module.css";

// "via Claude": this commitment, issue or value was added through an
// outside assistant acting as the person (Jason, 2026-10-14). The name
// comes from the row's added_via_assistant, which only the database
// sets, from the assistant's token (0278), so it cannot be faked or
// left off. Sits beside the person's name, quiet, like "From meeting".
export function ViaAssistantBadge({ name }: { name: string | null | undefined }) {
  if (!name) return null;
  return (
    <span className={styles.badge} title={`Added through ${name}, an outside assistant, on this person's behalf`}>
      via {name}
    </span>
  );
}
