"use client";

import { useEffect, useRef } from "react";
import styles from "./plan.module.css";

// Small client wrapper for the /plan cascade. It does two things:
//   1. Persists which SFA <details> the user has open in localStorage
//      so their layout survives navigation and refresh.
//   2. Renders Expand-all / Collapse-all buttons that toggle every
//      SFA + Goal <details> on the page at once.
//
// Both behaviors run entirely in the DOM — they don't fight the server
// component rendering because we only mutate `open` on <details>
// elements that already exist inside `children`.

const STORAGE_KEY_PREFIX = "aims.plan.sfaOpen.";

export function PlanCascadeController({
  companyId,
  children,
}: {
  companyId: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // On mount: restore each SFA's open state from localStorage.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sfas = container.querySelectorAll<HTMLDetailsElement>(
      "details[data-sfa-id]"
    );
    for (const details of sfas) {
      const id = details.dataset.sfaId;
      if (!id) continue;
      const stored = window.localStorage.getItem(storageKey(companyId, id));
      if (stored === "closed") details.open = false;
      else if (stored === "open") details.open = true;
    }

    // Bind change listeners to persist future toggles.
    const listeners: Array<[HTMLDetailsElement, () => void]> = [];
    for (const details of sfas) {
      const id = details.dataset.sfaId;
      if (!id) continue;
      const listener = () => {
        window.localStorage.setItem(
          storageKey(companyId, id),
          details.open ? "open" : "closed"
        );
      };
      details.addEventListener("toggle", listener);
      listeners.push([details, listener]);
    }
    return () => {
      for (const [element, listener] of listeners) {
        element.removeEventListener("toggle", listener);
      }
    };
  }, [companyId]);

  function setAll(open: boolean) {
    const container = containerRef.current;
    if (!container) return;
    const allDetails = container.querySelectorAll<HTMLDetailsElement>(
      "details[data-sfa-id], details[data-goal-id]"
    );
    for (const details of allDetails) {
      details.open = open;
      // Fire toggle event so localStorage persistence picks it up.
      details.dispatchEvent(new Event("toggle"));
    }
  }

  return (
    <>
      <div className={styles.cascadeToolbar}>
        <button
          type="button"
          className={styles.cascadeToggle}
          onClick={() => setAll(true)}
        >
          Expand all
        </button>
        <button
          type="button"
          className={styles.cascadeToggle}
          onClick={() => setAll(false)}
        >
          Collapse all
        </button>
      </div>
      <div ref={containerRef}>{children}</div>
    </>
  );
}

function storageKey(companyId: string, sfaId: string): string {
  return `${STORAGE_KEY_PREFIX}${companyId}.${sfaId}`;
}
