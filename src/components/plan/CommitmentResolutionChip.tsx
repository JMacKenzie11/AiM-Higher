import type { Commitment } from "@/lib/types";
import visuals from "./plan-visuals.module.css";

// Resolution chip variants per Section 8.3:
//   Kept           → success tint
//   Missed         → danger tint
//   Carried        → navy tint (neutral)
//   Completed late → warning tint  (status='missed' but completed_at set)
//   Open           → info tint     (in-progress; not called out explicitly
//                                   but every state deserves a chip)

type Variant = "kept" | "missed" | "carried" | "completed_late" | "open";

const LABELS: Record<Variant, string> = {
  kept: "Kept",
  missed: "Missed",
  carried: "Carried",
  completed_late: "Completed late",
  open: "Open",
};

const CLASSES: Record<Variant, string> = {
  kept: visuals.chipSuccess,
  missed: visuals.chipDanger,
  carried: visuals.chipNeutral,
  completed_late: visuals.chipWarning,
  open: visuals.chipInfo,
};

export function variantForCommitment(commitment: Commitment): Variant {
  if (commitment.status === "kept") return "kept";
  if (commitment.status === "carried") return "carried";
  if (commitment.status === "open") return "open";
  // status === "missed"
  return commitment.completed_at ? "completed_late" : "missed";
}

export function CommitmentResolutionChip({
  commitment,
}: {
  commitment: Commitment;
}) {
  const variant = variantForCommitment(commitment);
  return <span className={CLASSES[variant]}>{LABELS[variant]}</span>;
}
