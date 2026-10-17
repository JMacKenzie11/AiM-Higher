"use client";

import { useWorkDrawer, type IssueContext } from "@/components/work-drawer/context";
import { PlusIcon } from "@/components/ui/PlusIcon";
import styles from "./issues.module.css";

// "Add an issue" opens the drawer at once, on a new issue, with the
// description field focused (Jason, 2026-10-16). Saving it there adds
// the issue and leaves the drawer open on it, ready for commitments.
export function AddIssueButton({ ctx }: { ctx: Omit<IssueContext, "canEdit" | "canAdd"> }) {
  const drawer = useWorkDrawer();
  return (
    <button
      type="button"
      className={styles.addIssueButton}
      onClick={() => drawer?.openNewIssue({ ...ctx, canEdit: true, canAdd: true })}
    >
      <PlusIcon /> Add an issue
    </button>
  );
}
