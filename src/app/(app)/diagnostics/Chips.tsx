import { decisionLabel, statusLabel } from "@/lib/diagnostics/types";
import styles from "./diagnostics.module.css";

// The status and decision chips in the list tables, in the client
// portal's tones: under way in blue, at the readout in amber (the
// owner's decision is due), decided in green; a sprint chosen in green,
// pending or declined quiet.

export function StatusChip({ status }: { status: string }) {
  const tone = status === "decided" ? "" : status === "readout" ? styles.chipWarn : styles.chipInfo;
  return <span className={`${styles.chip} ${tone}`}>{statusLabel(status)}</span>;
}

export function DecisionChip({ decision }: { decision: string }) {
  const tone = decision === "sprint" ? "" : styles.chipMuted;
  return <span className={`${styles.chip} ${tone}`}>{decisionLabel(decision)}</span>;
}
