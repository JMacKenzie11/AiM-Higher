import type { Commitment } from "@/lib/types";
import visuals from "./plan-visuals.module.css";

// Resolution chip: Open, Kept, or Missed. "Missed" surfaces the
// status='missed' row — a commitment closed after its due date. We
// used to label this "Closed" but that reads as "finished" in
// everyday English, which is the opposite of what the row means.
// Migration 0011 removed the carried state entirely.

type Variant = "kept" | "missed" | "open";

const LABELS: Record<Variant, string> = {
  kept: "Kept",
  missed: "Missed",
  open: "Open",
};

const CLASSES: Record<Variant, string> = {
  kept: visuals.chipSuccess,
  missed: visuals.chipDanger,
  open: visuals.chipInfo,
};

export function variantForCommitment(commitment: Commitment): Variant {
  if (commitment.status === "kept") return "kept";
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
