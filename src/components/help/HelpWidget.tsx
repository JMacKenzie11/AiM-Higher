"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trackClient } from "@/lib/analytics/track-client";
import styles from "./HelpWidget.module.css";
import { usePageHelp } from "./usePageHelp";

// Floating help button, fixed to the bottom-right of every
// authenticated page. Click opens a panel that fetches the
// role/route-scoped help doc from /api/help and renders it inline.
// No content is preloaded — the fetch happens on open so the widget
// stays cheap on pages nobody uses it on.

export function HelpWidget() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const state = usePageHelp(pathname, open);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close whenever the URL changes; the help follows the page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape / outside click.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={panelRef}>
      {open ? (
        <div className={styles.panel} role="dialog" aria-label="Help">
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              {state.kind === "loaded" ? state.title : "Help"}
            </span>
            <button
              type="button"
              className={styles.closeButton}
              onClick={() => setOpen(false)}
              aria-label="Close help"
            >
              ×
            </button>
          </div>
          <div className={styles.panelBody}>
            {state.kind === "loading" ? (
              <p className={styles.muted}>Loading…</p>
            ) : state.kind === "empty" ? (
              <p className={styles.muted}>
                No help doc for this page yet. If you get stuck, ping the AiMS
                team.
              </p>
            ) : state.kind === "error" ? (
              <p className={styles.error}>{state.message}</p>
            ) : state.kind === "loaded" ? (
              <div className={styles.prose}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {state.markdown}
                </ReactMarkdown>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className={styles.trigger}
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) trackClient("help.opened", { pathname });
            return next;
          });
        }}
        aria-label={open ? "Close help" : "Open help"}
        data-testid="corner-launcher"
        aria-expanded={open}
      >
        {open ? "×" : "?"}
      </button>
    </div>
  );
}
