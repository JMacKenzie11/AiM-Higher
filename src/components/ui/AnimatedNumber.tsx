"use client";

import { useEffect, useState } from "react";

// Counts from 0 up to `value` over `duration` ms on mount using
// requestAnimationFrame with an ease-out cubic curve. Respects
// prefers-reduced-motion: users who've asked for less motion see the
// final number immediately.

export type AnimatedNumberProps = {
  value: number;
  duration?: number;
};

export function AnimatedNumber({ value, duration = 700 }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const from = 0;
    const to = value;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{display}</>;
}
