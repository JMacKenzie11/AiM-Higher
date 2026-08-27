"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SimilarMatch } from "@/lib/transcripts/similarity";
import styles from "./extracted.module.css";

// Click-to-open callout on the "Possibly already captured" pill.
// The badge itself stays subtle (same amber-tint pill as before);
// clicking it reveals a small anchored panel with the matched
// text quoted and a link to the surface where the row lives. The
// caller passes the SimilarMatch which already carries the kind
// (commitment | issue) and the matched text; the link target is
// the section-level page since neither /commitments nor /issues
// yet supports a per-id deep link.

export function SimilarMatchBadge({ match }: { match: SimilarMatch }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Close on outside click or Escape so a reader can dismiss
  // without hunting for a close button. Same shape as any
  // inline popover — no portal needed since the badge lives
  // inside a scrolling column and we want the panel to move
  // with the row.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const linkHref = match.kind === "commitment" ? "/commitments" : "/issues";
  const linkLabel =
    match.kind === "commitment" ? "View on Commitments" : "View on Issues";
  const kindLabel = match.kind === "commitment" ? "commitment" : "issue";

  return (
    <span ref={containerRef} className={styles.badgeAnchor}>
      <button
        type="button"
        className={styles.badgeButton}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Possibly already captured
      </button>
      {open ? (
        <div className={styles.badgePopover} role="dialog">
          <p className={styles.badgePopoverLabel}>
            Similar {kindLabel} on file
          </p>
          <p className={styles.badgePopoverText}>&ldquo;{match.text}&rdquo;</p>
          <Link
            href={linkHref}
            className={styles.badgePopoverLink}
            onClick={() => setOpen(false)}
          >
            {linkLabel} →
          </Link>
        </div>
      ) : null}
    </span>
  );
}
