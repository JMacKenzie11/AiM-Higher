"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TERMS, type TermKey } from "@/lib/terminology";
import styles from "./TermTooltip.module.css";

// Inline glossary tooltip for platform terms — Kept, Missed,
// Follow-Through Rate, Priority, SFA, Clarity, Success Measure.
// Renders the term's canonical label with a subtle dotted
// underline; hovering or focusing reveals a small definition
// panel below.
//
// Not a first-encounter dismissible — the underline stays present
// so a team member new-again after months away can re-hover for
// the definition. Cheap enough visually that permanent dotted
// underline doesn't distract; useful enough that it's always
// available.
//
// Accessibility:
//   - Wrapping <span> is focusable (tabIndex=0) so keyboard users
//     get the same reveal on Tab.
//   - Tooltip panel gets an id, term span gets aria-describedby.
//   - Escape while focused dismisses the panel (matches menu
//     idioms on other surfaces).

export function TermTooltip({
  term,
  className,
  children,
}: {
  term: TermKey;
  // Optional class for the wrapping span — lets callers align the
  // term with adjacent typography (e.g. a stat pill's small caps).
  className?: string;
  // Optional override for the visible text; defaults to the term's
  // canonical label. Useful when the surrounding sentence needs
  // "kept" lowercase or a pluralized form.
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const panelId = useId();
  const { label, definition } = TERMS[term];

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={`${styles.wrap} ${className ?? ""}`.trim()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      aria-describedby={open ? panelId : undefined}
    >
      <span className={styles.term}>{children ?? label}</span>
      {open ? (
        <span
          id={panelId}
          role="tooltip"
          className={styles.panel}
        >
          <span className={styles.panelLabel}>{label}</span>
          <span className={styles.panelDefinition}>{definition}</span>
        </span>
      ) : null}
    </span>
  );
}
