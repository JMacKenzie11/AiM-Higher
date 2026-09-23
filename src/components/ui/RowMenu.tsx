"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  Fragment,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./RowMenu.module.css";

// One trigger per row, holding the actions that were a row of
// buttons.
//
// ---- WHY THE MENU IS PORTALLED AND FIXED -----------------------
//
// The mechanics here are lifted from /people's RowActionsMenu, which
// learned them the hard way and wrote them down. An absolutely
// positioned menu is clipped by any ancestor with a non-visible
// overflow, and setting overflow on ONE axis makes the browser
// compute the other as auto — so a container scrolling horizontally
// clips the menu vertically, and the items below the fold become
// unreachable. A fixed element in a portal is clipped by none of it.
//
// The consequence is that the menu does not travel with its trigger,
// so it is repositioned on scroll and resize. Repositioned rather
// than closed: a stray trackpad nudge on the way to the menu should
// not dismiss it.
//
// ---- WHY THIS IS SHARED AND /people IS NOT CHANGED -------------
//
// This is the third surface to want the pattern, so it belongs in
// one place. /people's and /commitments' own menus are not touched:
// each is load-bearing on a surface with its own tests, and folding
// them in is a separate change with its own blast radius. This is
// the version the next surface should reach for.

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  // A rule above this item, to separate a destructive or unrelated
  // action from the ones above it.
  separatorBefore?: boolean;
};

export function RowMenu({
  label = "Actions",
  ariaLabel,
  items,
  disabled,
  testId,
}: {
  label?: ReactNode;
  ariaLabel: string;
  items: RowMenuItem[];
  disabled?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Close on outside click or Escape. The menu is not inside wrapRef
  // any more, so a click on one of its own items reads as "outside"
  // unless both refs are consulted.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Below the trigger and right-aligned with it, unless that runs off
  // the bottom, in which case above. Measured rather than estimated:
  // the height depends on how many actions this row offers.
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + 4;
    const fitsBelow = below + height <= window.innerHeight - 8;
    setPos({
      top: fitsBelow ? below : Math.max(8, rect.top - height - 4),
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  // Before paint, so it is never seen in the wrong place first.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    // Capture, because the scroll that moves the row is usually an
    // inner container's rather than the window's.
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, reposition]);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        disabled={disabled}
        data-testid={testId}
      >
        {label}
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.menu}
              role="menu"
              style={{
                position: "fixed",
                top: pos?.top ?? 0,
                right: pos?.right ?? 0,
                // Hidden for the single frame between mount and
                // measurement, which useLayoutEffect closes.
                visibility: pos ? "visible" : "hidden",
              }}
            >
              {/* Fragment, not a wrapping div: the menu is a flex
                  column and a wrapper would make each item a block
                  of its own, leaving the buttons shrink-wrapped
                  rather than filling the width they highlight on. */}
              {items.map((item) => (
                <Fragment key={item.label}>
                  {item.separatorBefore ? (
                    <div className={styles.separator} aria-hidden="true" />
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.item}
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false);
                      item.onSelect();
                    }}
                  >
                    {item.label}
                  </button>
                </Fragment>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
