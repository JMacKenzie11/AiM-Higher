"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Wraps the org chart in an auto-scaling container. The tree
// renders at its natural width (cards keep their max-width, so
// text stays readable), and if the total width exceeds the outer
// wrapper's inline size we apply `transform: scale()` so the whole
// thing shrinks to fit rather than clipping.
//
// Implementation notes:
//   * Inner is position: absolute so it sizes to its intrinsic
//     max-content width without any flex/inline shrink-to-fit
//     interference from the parent. An earlier version wrapped it
//     in a flex container and `scrollWidth` reported the outer
//     width instead of max-content, so the scale never tripped.
//   * transform-origin: top left keeps the scale math simple: the
//     scaled top-left corner stays at `left` px from the outer's
//     left edge, so we can position the visual box precisely by
//     setting left = (outerW - innerW * scale) / 2.
//   * ResizeObserver on both the outer (window resize) and the
//     inner (tree grew/shrunk from a card add/remove) keeps the
//     scale current without a scroll or window listener.

export function AutoFitTree({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [leftOffset, setLeftOffset] = useState(0);
  const [outerHeight, setOuterHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const measure = () => {
      const outerW = outer.clientWidth;
      // scrollWidth/scrollHeight return the pre-transform layout
      // dimensions, so we can read them straight without undoing
      // the current scale.
      const innerW = inner.scrollWidth;
      const innerH = inner.scrollHeight;
      const nextScale = innerW > 0 ? Math.min(1, outerW / innerW) : 1;
      const nextLeft = Math.max(0, (outerW - innerW * nextScale) / 2);
      setScale(nextScale);
      setLeftOffset(nextLeft);
      setOuterHeight(innerH * nextScale);
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      style={{
        width: "100%",
        position: "relative",
        overflow: "hidden",
        // Fall back to a sensible min-height before measurement
        // completes so the page doesn't collapse and jump.
        height: outerHeight,
        minHeight: outerHeight == null ? 320 : undefined,
      }}
    >
      <div
        ref={innerRef}
        style={{
          position: "absolute",
          top: 0,
          left: leftOffset,
          width: "max-content",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
