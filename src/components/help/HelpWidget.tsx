"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trackClient } from "@/lib/analytics/track-client";
import styles from "./HelpWidget.module.css";

// Floating help button, fixed to the bottom-right of every
// authenticated page. Click opens a panel that fetches the
// role/route-scoped help doc from /api/help and renders it inline.
// No content is preloaded — the fetch happens on open so the widget
// stays cheap on pages nobody uses it on.

type HelpState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; title: string; markdown: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function HelpWidget() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<HelpState>({ kind: "idle" });
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset content whenever the URL changes so the widget always
  // reflects the current surface.
  useEffect(() => {
    setState({ kind: "idle" });
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    // Deliberately NOT including state.kind in the deps: the moment
    // we call setState({kind:"loading"}) below, React re-runs this
    // effect (deps changed), which fires the cleanup, which aborts
    // the fetch we just started. Firing on [open, pathname] alone
    // means one fetch per open per URL — exactly what we want.
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(`/api/help?pathname=${encodeURIComponent(pathname)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 204) {
          setState({ kind: "empty" });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { title: string; markdown: string };
        setState({ kind: "loaded", title: data.title, markdown: data.markdown });
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load help.",
        });
      });
    return () => controller.abort();
  }, [open, pathname]);

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
        aria-expanded={open}
      >
        {open ? "×" : "?"}
      </button>
    </div>
  );
}
