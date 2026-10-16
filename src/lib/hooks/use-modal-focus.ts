"use client";

import { useEffect, useRef, type RefObject } from "react";

// Keyboard focus for anything that says aria-modal="true": the house
// Drawer, ConfirmDialog, and the Share this chat dialog.
//
// A modal promises a screen reader that the page behind is out of
// reach. Before this, Tab walked straight out of every one of them
// into the sidebar behind the scrim (UI audit X-03, aimee-help-3).
// The pattern here is the ARIA modal dialog one:
//
//   • focus moves in on open (a chosen control, or the container),
//   • Tab and Shift+Tab wrap inside it,
//   • Escape closes it,
//   • focus goes back to whatever opened it.
//
// ---- WHY A LAYER STACK ------------------------------------------
//
// Modals nest. /chart's function drawer opens a ConfirmDialog to
// delete; both listen for keys on the document. Without an order,
// the drawer's trap pulled focus back out of the dialog on every Tab,
// and one Escape closed both. Each open modal pushes a token; only
// the top one answers Tab and Escape. A side panel (Aimee on desktop)
// is not modal and never pushes one.

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const layers: object[] = [];

// Register an open modal. Returns the function that removes it.
export function pushModalLayer(token: object): () => void {
  layers.push(token);
  return () => {
    const i = layers.lastIndexOf(token);
    if (i >= 0) layers.splice(i, 1);
  };
}

export function isTopModalLayer(token: object): boolean {
  return layers[layers.length - 1] === token;
}

// Where Tab should go instead of where the browser would send it, or
// null to let the browser move as usual. `active` is the focused
// stop, or null when focus is outside the stops (on the container
// itself, on the body, or somewhere behind the modal). Pure, so it
// tests without a DOM.
export function wrapTabTarget<T>(
  stops: readonly T[],
  active: T | null,
  shift: boolean
): T | null {
  if (stops.length === 0) return null;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (active === null || !stops.includes(active)) return shift ? last : first;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}

// The controls Tab can reach inside `container`, in DOM order. Skips
// anything not laid out: a keepMounted drawer's hidden children, a
// closed <details>.
export function tabStopsIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0
  );
}

// Handle one Tab keydown for a modal container: wrap at the ends, and
// pull focus back in if it has got out.
export function trapTab(container: HTMLElement, e: KeyboardEvent): void {
  const stops = tabStopsIn(container);
  if (stops.length === 0) {
    e.preventDefault();
    container.focus();
    return;
  }
  const focused = document.activeElement;
  const active =
    focused instanceof HTMLElement && container.contains(focused) && focused !== container
      ? focused
      : null;
  const target = wrapTabTarget(stops, active, e.shiftKey);
  if (target) {
    e.preventDefault();
    target.focus();
  }
}

// The whole pattern, for a modal that is not the Drawer (which keeps
// its own Escape rules for side panels and uses the helpers above).
// `active` is "open AND in the DOM": a portalled dialog renders null
// until it has mounted, and an effect that ran before then found no
// element to focus, which is why Share this chat left focus on the
// button that opened it.
export function useModalFocus({
  active,
  containerRef,
  initialFocusRef,
  onEscape,
}: {
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape: () => void;
}) {
  // Through refs, so the effect depends on `active` alone. Callers pass
  // inline arrows; depending on them re-ran the effect every render and
  // dragged focus back to the first control on every keystroke.
  const onEscapeRef = useRef(onEscape);
  const initialRef = useRef(initialFocusRef);
  useEffect(() => {
    onEscapeRef.current = onEscape;
    initialRef.current = initialFocusRef;
  });

  useEffect(() => {
    if (!active) return;
    const token = {};
    const popLayer = pushModalLayer(token);
    const opener = document.activeElement;
    (initialRef.current?.current ?? containerRef.current)?.focus();

    function onKey(e: KeyboardEvent) {
      if (!isTopModalLayer(token)) return;
      if (e.key === "Escape") {
        onEscapeRef.current();
      } else if (e.key === "Tab" && containerRef.current) {
        trapTab(containerRef.current, e);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      popLayer();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [active, containerRef]);
}
