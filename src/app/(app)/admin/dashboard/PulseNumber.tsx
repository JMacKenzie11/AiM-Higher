"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./dashboard.module.css";

// Big number in a pulse-strip card, with a count-up animation on
// first mount. If format="cents" the value is treated as USD cents
// and formatted "$X.XX"; otherwise it's a plain integer with
// thousand separators.
//
// Respects prefers-reduced-motion — under that setting we snap to
// the final value on mount, no animation.

const DURATION_MS = 900;

export function PulseNumber({
  value,
  format = "integer",
}: {
  value: number;
  format?: "integer" | "cents";
}) {
  const [display, setDisplay] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION_MS);
      // Ease out (cubic) — starts fast, decelerates to the target.
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const rendered =
    format === "cents"
      ? `$${(display / 100).toFixed(2)}`
      : display.toLocaleString();

  return (
    <span className={`${styles.pulseValue} aims-tabular`}>{rendered}</span>
  );
}
