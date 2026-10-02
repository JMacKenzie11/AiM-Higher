import { TermTooltip } from "./TermTooltip";
import styles from "./NeedsRewordingTag.module.css";

// A commitment or issue that mentions somebody's private life and could
// not be reworded automatically (src/lib/transcripts/redact.ts, 0250).
// Shown only to people who can edit the text, beside it, so they can
// reword it; the database clears the mark when the text changes. The
// explanation is the glossary's (TERMS.needsRewording).
export function NeedsRewordingTag() {
  return (
    <span className={styles.tag}>
      <TermTooltip term="needsRewording" />
    </span>
  );
}
