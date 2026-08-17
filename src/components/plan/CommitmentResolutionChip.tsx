import type { Commitment } from "@/lib/types";
import visuals from "./plan-visuals.module.css";

// Resolution chip: Open, Kept on time, Kept late, or Missed.
// Kept late shares the success treatment with a "late" qualifier —
// the person still did the work, just after the due date. It's NOT
// styled as a failure state (no X, no danger colour) per the AiMS
// resolution model. Missed is the only failure state.

type Variant = "kept_on_time" | "kept_late" | "missed" | "open";

const LABELS: Record<Variant, string> = {
  kept_on_time: "Kept",
  kept_late: "Kept, late",
  missed: "Missed",
  open: "Open",
};

const CLASSES: Record<Variant, string> = {
  kept_on_time: visuals.chipSuccess,
  // Muted success — same green family, softer weight. If the
  // stylesheet gains a dedicated `chipSuccessMuted`, swap it in.
  kept_late: visuals.chipSuccess,
  missed: visuals.chipDanger,
  open: visuals.chipInfo,
};

export function variantForCommitment(commitment: Commitment): Variant {
  if (commitment.status === "kept_on_time") return "kept_on_time";
  if (commitment.status === "kept_late") return "kept_late";
  if (commitment.status === "missed") return "missed";
  return "open";
}

export function CommitmentResolutionChip({
  commitment,
}: {
  commitment: Commitment;
}) {
  const variant = variantForCommitment(commitment);
  return <span className={CLASSES[variant]}>{LABELS[variant]}</span>;
}
