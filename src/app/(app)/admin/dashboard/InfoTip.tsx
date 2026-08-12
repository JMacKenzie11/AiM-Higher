"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./dashboard.module.css";

// Small ⓘ icon that reveals a tooltip on hover, focus, or tap.
// The tooltip renders through a portal to document.body so it
// escapes the parent's stacking context or overflow: hidden
// (pulse cards have both). Positioned above the icon when there's
// room, otherwise below — measured from the anchor's client rect
// so it works whether the page is scrolled or not.
//
// Keyboard: the trigger is a real <button> so it's tabbable and
// takes Enter/Space. Touch: tap toggles; tap outside dismisses.

export function InfoTip({ text }: { text: string }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: "above" | "below";
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Recompute position whenever the tip opens. Measure the anchor's
  // rect, prefer above; if not enough room above, flip below. Clamp
  // horizontally so long tooltips don't overflow the viewport.
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const tipEl = tipRef.current;
    // Rough width guess for first paint; overwritten once tipEl mounts.
    const tipWidth = tipEl?.offsetWidth ?? 260;
    const tipHeight = tipEl?.offsetHeight ?? 60;
    const gap = 10;
    const spaceAbove = rect.top;
    const placement = spaceAbove > tipHeight + gap + 8 ? "above" : "below";
    const top =
      placement === "above"
        ? rect.top + window.scrollY - tipHeight - gap
        : rect.bottom + window.scrollY + gap;
    const rawLeft = rect.left + window.scrollX + rect.width / 2 - tipWidth / 2;
    const clampedLeft = Math.max(
      8,
      Math.min(window.innerWidth - tipWidth - 8, rawLeft)
    );
    setPos({ top, left: clampedLeft, placement });
  }, [open]);

  // Close on outside click and on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        anchorRef.current?.contains(e.target as Node) ||
        tipRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={styles.infoTipTrigger}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Tap-toggle for touch — stop propagation so the
          // outside-click handler doesn't immediately close it.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={text}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>
      {mounted && open && pos
        ? createPortal(
            <div
              ref={tipRef}
              role="tooltip"
              className={`${styles.infoTip} ${
                pos.placement === "above"
                  ? styles.infoTipAbove
                  : styles.infoTipBelow
              }`}
              style={{ top: pos.top, left: pos.left }}
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
