"use client";

import { useEffect, useState } from "react";
import {
  CompleteRoleDescriptionDrawer,
  type InitialGaps,
} from "./CompleteRoleDescriptionDrawer";
import styles from "../../chart.module.css";

// Client-side trigger that owns the drawer's open/close state. The
// readiness card (server component) computes the gaps and hands them
// in here so the drawer's step queue is deterministic from the
// server-rendered readiness view.
//
// openCount increments on each open — used as a React key on the
// drawer so every open produces a fresh instance with fresh local
// state (stepIndex, addedByKind, input drafts). This is what makes
// second-and-later opens work reliably; a boolean flip alone let
// stale closures / effect timings leak between sessions.

export function CompleteRoleDescriptionButton({
  gaps,
  allReady,
}: {
  gaps: InitialGaps;
  allReady: boolean;
}) {
  const [openCount, setOpenCount] = useState(0);
  const [open, setOpen] = useState(false);

  // Lock body scroll while the drawer is open so the user can't get
  // stranded on the underlying page's scroll position and miss the
  // overlay entirely.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function handleOpen() {
    setOpenCount((c) => c + 1);
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
  }

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
        onClick={handleOpen}
      >
        {allReady ? "Role description ready" : "Complete role description"}
      </button>
      <CompleteRoleDescriptionDrawer
        key={openCount}
        open={open}
        onClose={handleClose}
        gaps={gaps}
      />
    </>
  );
}
