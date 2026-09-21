"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Drawer.module.css";

// The house drawer: scrim, panel in from the right, gradient head.
//
// ---- WHY IT PORTALS -------------------------------------------
//
// `position: fixed` resolves against the nearest ancestor carrying a
// transform, filter or perspective — not the viewport — and the cards
// these open from have all three at various breakpoints. Portalling
// to document.body is what makes "fixed" mean fixed. ConfirmDialog
// carries the same note for the same reason.
//
// It also takes the panel out of whatever grid or flow it was
// declared in, which on /issues was the difference between a card
// that stayed put and one that doubled in height under your thumb.
//
// ---- WHY keepMounted EXISTS ------------------------------------
//
// A drawer that returns null when closed UNMOUNTS its children, and
// that is not always safe. The /plan add forms call router.refresh()
// in an effect on success and then close; unmounting them at the
// moment they close is the shape of a bug this codebase has already
// had — a previous attempt to own those panels in React state
// discarded an in-flight refresh and the created row never appeared.
// See AddPanels.tsx, which is why they were native <details>: closing
// a <details> hides its content without unmounting anything.
//
// keepMounted reproduces that. The children render once and stay;
// open/closed only toggles `hidden`. Use it for anything whose
// children own state or in-flight work that must survive a close.
// Without it the drawer unmounts, which is the right default for a
// panel that only reads and writes on demand.

export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  children,
  footer,
  keepMounted = false,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  // Keep children in the DOM while closed. See the note above.
  keepMounted?: boolean;
  // Override the generated aria-labelledby, for a caller that renders
  // its own heading inside the body.
  labelledBy?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<Element | null>(null);
  const generatedId = useId();
  const titleId = labelledBy ?? `drawer-title-${generatedId}`;

  // document.body does not exist during SSR.
  useEffect(() => {
    setMounted(true);
  }, []);

  // onClose through a ref, so the effect below depends on `open` and
  // nothing else. Callers pass an inline arrow — `() => setWhich(null)`
  // — which is a new identity on every render, and depending on it
  // directly re-ran this effect constantly while the drawer was open:
  // cleanup pulled focus back to the trigger, the effect pushed it
  // into the panel, on every keystroke in a form inside it.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Escape closes. Focus moves into the panel on open and back to
  // whatever opened it on close — usually a small button somebody
  // would otherwise have to find again.
  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement;
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = returnFocusTo.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [open]);

  if (!mounted) return null;
  if (!open && !keepMounted) return null;

  return createPortal(
    <>
      <div
        className={styles.scrim}
        hidden={!open}
        onClick={onClose}
        data-testid="drawer-scrim"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        hidden={!open}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="drawer-panel"
      >
        <div className={styles.head}>
          <div>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.body}>{children}</div>

        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </>,
    document.body
  );
}
