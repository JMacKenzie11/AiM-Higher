"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Wraps the org chart in an auto-scaling container. The tree
// renders at its natural width (cards keep their max-width, so
// text stays readable), and if the total width exceeds the tree
// card's inner width we apply `transform: scale()` so the whole
// thing shrinks to fit rather than clipping or overflowing.
//
// Two ResizeObservers keep the scale current: one on the outer
// wrapper (so we react when the tree card resizes with the
// window) and one on the inner content (so we react when the
// tree grows — a new function added, a sub-branch opened).
//
// Because transform: scale doesn't affect layout dimensions, we
// also compute the scaled height and set it on the outer wrapper —
// otherwise scaling down would leave empty space below the tree.

export function AutoFitTree({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [outerHeight, setOuterHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const measure = () => {
      // Undo any current transform first so the measurement reflects
      // the intrinsic layout size, not the last scaled render.
      const priorTransform = inner.style.transform;
      inner.style.transform = "";
      const outerWidth = outer.clientWidth;
      const contentWidth = inner.scrollWidth;
      const contentHeight = inner.scrollHeight;
      inner.style.transform = priorTransform;

      const nextScale =
        contentWidth > 0 ? Math.min(1, outerWidth / contentWidth) : 1;
      setScale(nextScale);
      setOuterHeight(contentHeight * nextScale);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      style={{
        width: "100%",
        overflow: "hidden",
        // Fall back to a sensible min-height on first render before
        // measurement runs so the page doesn't collapse and jump.
        height: outerHeight,
        minHeight: outerHeight == null ? 320 : undefined,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      <div
        ref={innerRef}
        style={{
          // width: max-content forces the inner box to its
          // intrinsic width — the natural size of the tree with
          // every card at its full max-width. Without this, flex
          // children inside would shrink to fit the available
          // width and scrollWidth would equal outer width, so
          // the scale would never trip.
          width: "max-content",
          transform: `scale(${scale})`,
          transformOrigin: "top center",
          // Prevent flex from stretching the item — we want to
          // measure the intrinsic width, not have it grow.
          flex: "0 0 auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}
