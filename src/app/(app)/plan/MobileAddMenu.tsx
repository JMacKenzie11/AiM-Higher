"use client";

import { useState, type ReactNode } from "react";
import { PlusIcon } from "@/components/ui/PlusIcon";
import styles from "./plan.module.css";

// The four add buttons in the plan toolbar, behind one Add on a phone.
//
// At 390px they stacked over three rows and took most of the card
// above the fold, on the surface where the content underneath is the
// whole point. On desktop there is room for four and a menu would be
// a click tax, so this only collapses below the breakpoint: the
// trigger is display:none above it and the row renders exactly as it
// always has.
//
// IT WRAPS, IT DOES NOT REBUILD. The children are the same four
// <details> the toolbar already rendered, passed through untouched as
// elements. This component owns one boolean and nothing else — no
// form state, no refresh, no close-on-success. That is deliberate:
// the last attempt to own the add panels in React state discarded an
// in-flight router.refresh() and the created row never appeared. A
// menu that only shows and hides its children cannot do that.
export function MobileAddMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.mobileAddTrigger}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <PlusIcon />
        Add
      </button>
      <div
        className={styles.toolbarActions}
        data-mobile-open={open ? "true" : undefined}
      >
        {children}
      </div>
    </>
  );
}
