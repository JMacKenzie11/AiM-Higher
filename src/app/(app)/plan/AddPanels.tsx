"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./plan.module.css";

// The add panels in the plan toolbar, and how they get out of the way.
//
// Each panel is a native <details>. That is deliberate and unchanged:
// a previous attempt to own these in React state discarded an
// in-flight router.refresh() and the created row never appeared, so
// the elements keep owning whether they are open and this only ever
// nudges them shut.
//
// THREE WAYS TO DISMISS, because a panel that can only be closed by
// pressing the same button that opened it is a panel people leave
// open and then scroll past.
//
//   click anywhere outside   the obvious one, and the one asked for
//   Escape                   what every popover in every application
//                            has taught people to expect
//   opening another panel    closing the first, because two open at
//                            once was the original complaint about
//                            this toolbar
//
// The third is what <details name="..."> would give natively, and it
// is done here instead for one reason: it has to compose with the
// other two. A named group closes its siblings but knows nothing
// about an outside click, so the two mechanisms would each hold a
// different idea of what is open.
//
// POINTERDOWN, NOT CLICK. A click completes only if the element under
// the pointer is still there on mouseup. These panels sit over the
// cascade, and closing one on `click` means the click that dismissed
// it also lands on whatever was underneath — a row, a link, another
// disclosure. Pointerdown dismisses before that can happen.
export function AddPanels({
  children,
  mobileOpen,
}: {
  children: ReactNode;
  // Whether the mobile Add menu is showing this row. Owned by
  // MobileAddMenu, which is a separate concern: that decides whether
  // the toolbar is visible at all on a phone, this decides when a
  // panel inside it closes.
  mobileOpen: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const panels = () =>
      Array.from(container.querySelectorAll<HTMLDetailsElement>("details"));

    const closeAll = (except?: HTMLDetailsElement) => {
      for (const panel of panels()) {
        if (panel !== except && panel.open) panel.open = false;
      }
    };

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      // Inside the toolbar: either the person is using an open panel,
      // or they are opening another one, and `toggle` below handles
      // that case with the element's own new state rather than
      // guessing from the click.
      if (target && container!.contains(target)) return;
      closeAll();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Only when something is open, so Escape keeps meaning whatever
      // it meant before to a dialog or a select underneath.
      if (panels().some((p) => p.open)) closeAll();
    }

    function onToggle(event: Event) {
      const panel = event.target as HTMLDetailsElement;
      if (panel.open) closeAll(panel);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // `toggle` does not bubble, so it is listened for in the capture
    // phase rather than on the container. A listener per panel would
    // need rebinding whenever the toolbar's children change, which
    // they do: the priority panel only exists when a quarter is open.
    container.addEventListener("toggle", onToggle, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("toggle", onToggle, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={styles.toolbarActions}
      data-mobile-open={mobileOpen ? "true" : undefined}
    >
      {children}
    </div>
  );
}
