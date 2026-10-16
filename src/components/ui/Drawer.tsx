"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isTopModalLayer, pushModalLayer, trapTab } from "@/lib/hooks/use-modal-focus";
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
  name,
  side = false,
  trapFocus,
  initialFocusRef,
  fill = false,
  testId = "drawer-panel",
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  // A node rather than a string, for the caller that makes its
  // heading editable in place — /chart's function drawer renders a
  // click-to-rename control here. Pass a string for everything else.
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  // Keep children in the DOM while closed. See the note above.
  keepMounted?: boolean;
  // Override the generated aria-labelledby, for a caller that renders
  // its own heading inside the body.
  labelledBy?: string;
  // Tells two drawers on one page apart, for a test. /chart has two:
  // the keepMounted "Add function" panel, which is in the DOM even
  // when closed, and the function editor. `data-testid` matches both.
  name?: string;
  // SIDE: beside the page rather than over it. No scrim, no
  // aria-modal, a labelled complementary region rather than a dialog,
  // so the page behind stays usable and in the tab order. Escape still
  // closes it and focus still goes back where it came from. Aimee's
  // panel on desktop (docs/investigations/aimee-panel.md, "A panel
  // that does not block the page"). Every other drawer is modal.
  side?: boolean;
  // Keep Tab inside the panel. On by default for every modal drawer,
  // since aria-modal tells a screen reader the page behind is out of
  // reach (UI audit X-03). Off by default for a side panel, whose page
  // stays in use. Pass false only for a modal that must let Tab out.
  trapFocus?: boolean;
  // Where focus goes on open, instead of the panel itself.
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  // FILL: the body is a bare column the caller lays out itself, with
  // no padding and no scroll of its own. For content that scrolls in
  // parts (Aimee's panel: the conversation scrolls, its composer
  // stays put). Every other drawer scrolls its padded body.
  fill?: boolean;
  // The panel's data-testid. "drawer-panel" for the drawers a page
  // opens, which specs find as THE drawer. Aimee's panel is on every
  // page and kept mounted, so it takes its own, or every one of those
  // specs would find two.
  testId?: string;
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
  const trap = trapFocus ?? !side;
  const trapFocusRef = useRef(trap);
  const sideRef = useRef(side);
  const initialFocus = useRef(initialFocusRef);
  useEffect(() => {
    onCloseRef.current = onClose;
    trapFocusRef.current = trap;
    sideRef.current = side;
    initialFocus.current = initialFocusRef;
  });

  // Escape closes. Focus moves into the panel on open and back to
  // whatever opened it on close — usually a small button somebody
  // would otherwise have to find again. Waits for `mounted`: a drawer
  // open on first render has no panel to focus until the portal is in.
  //
  // A modal drawer joins the modal layer stack (use-modal-focus.ts), so
  // a ConfirmDialog opened from inside it owns Tab and Escape until it
  // closes, and one Escape closes the dialog without the drawer.
  useEffect(() => {
    if (!open || !mounted) return;
    const token = {};
    const popLayer = sideRef.current ? null : pushModalLayer(token);
    returnFocusTo.current = document.activeElement;
    (initialFocus.current?.current ?? panelRef.current)?.focus();
    function onKey(e: KeyboardEvent) {
      if (popLayer && !isTopModalLayer(token)) return;
      if (e.key === "Escape") {
        // TWO CAN BE OPEN: Aimee's side panel beside a modal drawer
        // (/chart's function editor). Escape closes the one it was
        // pressed in. A side panel closes only from inside itself,
        // since the page beside it is in use and has its own Escapes.
        // data-drawer marks every drawer's panel, whatever its test id.
        const inDrawer = (e.target as Element | null)?.closest?.("[data-drawer]") ?? null;
        if (inDrawer && inDrawer !== panelRef.current) return;
        if (sideRef.current && inDrawer !== panelRef.current) return;
        onCloseRef.current();
      }
      if (e.key === "Tab" && trapFocusRef.current && panelRef.current) {
        // Aimee's side panel beside this one stays usable: Tab inside
        // it is its own business.
        const inDrawer = (e.target as Element | null)?.closest?.("[data-drawer]") ?? null;
        if (inDrawer && inDrawer !== panelRef.current) return;
        trapTab(panelRef.current, e);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      popLayer?.();
      const back = returnFocusTo.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [open, mounted]);

  if (!mounted) return null;
  if (!open && !keepMounted) return null;

  return createPortal(
    <>
      {side ? null : (
        <div
          className={styles.scrim}
          hidden={!open}
          onClick={onClose}
          data-testid="drawer-scrim"
          data-drawer-name={name}
        />
      )}
      <div
        ref={panelRef}
        tabIndex={-1}
        hidden={!open}
        className={side ? `${styles.panel} ${styles.side}` : styles.panel}
        role={side ? "complementary" : "dialog"}
        aria-modal={side ? undefined : "true"}
        aria-labelledby={titleId}
        data-testid={testId}
        data-drawer=""
        data-drawer-name={name}
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

        <div className={fill ? `${styles.body} ${styles.bodyFill}` : styles.body}>{children}</div>

        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </>,
    document.body
  );
}
