import type { CascadeStatus } from "@/lib/types";
import styles from "./plan-visuals.module.css";

// Status chip per Section 8.2 / Section 3:
//   not_started → navy-tint
//   on_track / ongoing → sky-tint
//   behind → warning-tint
//   complete → success-tint
// Dark text on tinted background, pill shape.

const LABELS: Record<CascadeStatus, string> = {
  not_started: "Not started",
  on_track: "On track",
  behind: "Behind",
  complete: "Complete",
  ongoing: "Ongoing",
};

const CLASSES: Record<CascadeStatus, string> = {
  not_started: styles.chipNeutral,
  on_track: styles.chipInfo,
  behind: styles.chipWarning,
  complete: styles.chipSuccess,
  ongoing: styles.chipInfo,
};

export function StatusChip({ status }: { status: CascadeStatus }) {
  return <span className={CLASSES[status]}>{LABELS[status]}</span>;
}
