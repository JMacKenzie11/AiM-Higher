"use client";

import { useState } from "react";
import {
  CompleteRoleDescriptionDrawer,
  type InitialGaps,
} from "./CompleteRoleDescriptionDrawer";
import styles from "../../chart.module.css";

// Client-side trigger that owns the drawer's open/close state. The
// readiness card (server component) computes the gaps and hands them
// in here so the drawer's step queue is deterministic from the
// server-rendered readiness view.

export function CompleteRoleDescriptionButton({
  gaps,
  allReady,
}: {
  gaps: InitialGaps;
  allReady: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.rdReadinessAction}
        disabled={allReady}
        title={
          allReady
            ? "Nothing to do — every required section has an answer."
            : "Walk through the missing sections one question at a time."
        }
        onClick={() => setOpen(true)}
      >
        {allReady ? "Role description ready" : "Complete role description"}
      </button>
      <CompleteRoleDescriptionDrawer
        open={open}
        onClose={() => setOpen(false)}
        gaps={gaps}
      />
    </>
  );
}
