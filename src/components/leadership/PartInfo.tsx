"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./FacilitationReview.module.css";

// The (i) after each part name in "How this is scored", and what the
// part measures.
//
// ---- WHY ITS OWN PATTERN ---------------------------------------
//
// The design system has TermTooltip, which underlines a word rather
// than offering an icon, and the admin dashboard has a local InfoTip
// that is not in the design system and has two gaps for this: it puts
// the whole definition in the button's accessible NAME, and on a phone
// a tap opens it on focus and then closes it again on the click. So
// this is one small pattern, used here only.
//
// ---- HOW IT BEHAVES --------------------------------------------
//
//   hover (mouse)    opens while the pointer is over the icon
//   keyboard focus   opens on focus, closes on blur or Escape
//   tap (touch)      toggles; a tap anywhere else closes it
//
// The definition is always in the DOM for screen readers, visually
// hidden, and tied to the button with aria-describedby, so it is read
// whether or not the popover is showing. The popover is drawn in a
// portal because the score table scrolls sideways on a phone, and a
// popover inside it would be clipped.

export function PartInfo({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  // `measured` is false for the first frame: the popover renders
  // hidden, measures its real height, and only then is placed and
  // shown. Placed on a guessed height it could land over the icon
  // when flipped above, count as the pointer leaving, and close.
  const [pos, setPos] = useState<{ top: number; left: number; measured: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // A focus that arrives with a pointer press is not keyboard focus:
  // the click that follows decides, so a tap is one toggle, not two.
  const pressed = useRef(false);
  const descId = useId();

  useEffect(() => setMounted(true), []);

  // Lined up with the icon's left edge rather than centred on it, so
  // it opens over the table and not over the sidebar; below the icon,
  // or above it when the window has no room underneath.
  const place = useCallback(() => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    const height = popRef.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left - 12));
    const below = r.bottom + 8;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - 8 - height) : below;
    setPos({ top, left, measured: popRef.current !== null });
  }, []);

  // Once the hidden popover is on the page, measure and show it,
  // before the browser paints. A layout effect, not a frame callback:
  // the frame could arrive before the popover was committed, leaving
  // it measured never and hidden for good (seen on a phone).
  useLayoutEffect(() => {
    if (open && pos && !pos.measured) place();
  }, [open, pos, place]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const onAway = (e: PointerEvent) => {
      if (buttonRef.current?.contains(e.target as Node) || popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onAway);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onAway);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.partInfo}
        aria-label={`What ${label} measures`}
        aria-describedby={descId}
        aria-expanded={open}
        onPointerDown={() => {
          pressed.current = true;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setOpen(false);
        }}
        onFocus={() => {
          if (!pressed.current) setOpen(true);
        }}
        onBlur={() => {
          pressed.current = false;
          setOpen(false);
        }}
        onClick={() => {
          pressed.current = false;
          setOpen((v) => !v);
        }}
      >
        <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
          <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="8" cy="5" r="0.9" fill="currentColor" />
          <path d="M8 7.25v4.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <span id={descId} className={styles.srOnly}>
        {text}
      </span>
      {mounted && open && pos
        ? createPortal(
            <div
              ref={popRef}
              role="tooltip"
              className={styles.partInfoPop}
              style={{ top: pos.top, left: pos.left, visibility: pos.measured ? "visible" : "hidden" }}
            >
              <span className={styles.partInfoLabel}>{label}</span>
              {text}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
