"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./dashboard.module.css";

// Glass stat card in the dashboard hero band. If a tooltip is
// provided, the card becomes hover/focus-interactive and the tooltip
// is rendered via a portal to document.body so it escapes every
// parent stacking context (the brief card, in particular, has its
// own via isolation: isolate).

export function HeroStat({
  label,
  value,
  caption,
  tooltip,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tooltip?: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!show || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + window.scrollY + 10,
      left: rect.left + window.scrollX,
    });
  }, [show]);

  const interactive = Boolean(tooltip);

  return (
    <div
      ref={anchorRef}
      className={styles.heroStat}
      tabIndex={interactive ? 0 : undefined}
      onMouseEnter={interactive ? () => setShow(true) : undefined}
      onMouseLeave={interactive ? () => setShow(false) : undefined}
      onFocus={interactive ? () => setShow(true) : undefined}
      onBlur={interactive ? () => setShow(false) : undefined}
    >
      <span className={`${styles.heroStatValue} aims-tabular`}>{value}</span>
      <span className={styles.heroStatLabel}>{label}</span>
      {caption ? (
        <span className={styles.heroStatCaption}>{caption}</span>
      ) : null}
      {mounted && interactive && show && pos
        ? createPortal(
            <span
              role="tooltip"
              className={styles.heroStatTooltip}
              style={{ top: pos.top, left: pos.left }}
            >
              {tooltip}
            </span>,
            document.body
          )
        : null}
    </div>
  );
}
