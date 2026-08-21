"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Wraps a block that should fade + slide into place the first time
// the user scrolls it into view. Sets data-reveal="in" on the
// wrapper on intersection so children can style themselves off that
// state (opacity, transform, stagger delays). Fires once, then
// disconnects.
//
// SSR flow: server renders with no data-reveal attribute (children
// visible, safe fallback). Client uses an isomorphic layout effect
// to synchronously flip to "pending" before the first paint, so
// there's no visible flash from opacity:1 → opacity:0 → reveal.
// The observer then fires on the next microtask; if the element is
// already in view it reveals immediately.

type Props = {
  children: ReactNode;
  className?: string;
  // Fraction of the element that must be visible before the reveal
  // fires. 0.25 = a quarter of the wrapper on screen; sensible for
  // stat bands and card rows that we want to land before the user
  // reads them.
  threshold?: number;
};

// useLayoutEffect warns on the server; useEffect is safe there.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function RevealOnScroll({
  children,
  className,
  threshold = 0.25,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"pending" | "in" | null>(null);

  useIsomorphicLayoutEffect(() => {
    setState("pending");
  }, []);

  useEffect(() => {
    if (state !== "pending") return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setState("in");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setState("in");
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [state, threshold]);

  return (
    <div ref={ref} className={className} data-reveal={state ?? undefined}>
      {children}
    </div>
  );
}
