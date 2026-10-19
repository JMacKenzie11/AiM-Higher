"use client";

import { useWorkDrawer, type NewCommitmentContext } from "@/components/work-drawer/context";
import { PlusIcon } from "@/components/ui/PlusIcon";
import styles from "../issues/issues.module.css";

// "Add a commitment" opens the work drawer on a new commitment, the
// way "Add an issue" opens a new issue (the add-panel switch; Jason,
// 2026-10-19). It replaces the always-open add row and sits top right
// of the first card, where a page's main action goes.
export function AddCommitmentButton({ ctx }: { ctx: NewCommitmentContext }) {
  const drawer = useWorkDrawer();
  return (
    <button type="button" className={styles.addIssueButton} onClick={() => drawer?.openNewCommitment(ctx)}>
      <PlusIcon /> Add a commitment
    </button>
  );
}
