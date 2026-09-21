"use client";

import { type ReactNode } from "react";
import styles from "./plan.module.css";

// The toolbar's add row.
//
// This used to do considerably more. The add controls were native
// <details> with floating panels, and this component gave them the
// three dismissals such a panel needs: click outside, Escape, and
// closing the open one when another is opened. All three are now the
// Drawer's, and the third stopped being a rule at all — there is one
// drawer whose contents change, so opening another IS closing the
// first.
//
// What is left is the row, and whether it is on screen on a phone.
// That second part is still MobileAddMenu's call, passed in here.
//
// The history is worth keeping in view: the panels were native
// <details> because an earlier attempt to own them in React state
// discarded an in-flight router.refresh() and the created row never
// appeared. The drawer does own them in state now, and answers that
// by never unmounting them — see PlanAddDrawers.
export function AddPanels({
  children,
  mobileOpen,
}: {
  children: ReactNode;
  mobileOpen: boolean;
}) {
  return (
    <div
      className={styles.toolbarActions}
      data-mobile-open={mobileOpen ? "true" : undefined}
    >
      {children}
    </div>
  );
}
