import type { Commitment } from "@/lib/types";
import visuals from "./plan-visuals.module.css";

// Resolution chip: Open, Kept, or Closed. A "Closed" chip corresponds
// to status='missed' at the DB level — the commitment was closed after
// its due date. Migration 0011 removed the carried state entirely.

type Variant = "kept" | "closed" | "open";

const LABELS: Record<Variant, string> = {
  kept: "Kept",
  closed: "Closed",
  open: "Open",
};

const CLASSES: Record<Variant, string> = {
  kept: visuals.chipSuccess,
  closed: visuals.chipDanger,
  open: visuals.chipInfo,
};

export function variantForCommitment(commitment: Commitment): Variant {
  if (commitment.status === "kept") return "kept";
  if (commitment.status === "missed") return "closed";
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
