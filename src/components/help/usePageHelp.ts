"use client";

import { useEffect, useState } from "react";

// The help for the page the person is on, from /api/help (the loader's
// role and section filtering, server-side). Fetched when `active` turns
// on, and again when the page changes while it is on. Shared by the "?"
// widget and Aimee's panel ("About this page"), so both read the same
// doc the same way.

export type PageHelpState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; title: string; markdown: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function usePageHelp(pathname: string, active: boolean): PageHelpState {
  const [state, setState] = useState<PageHelpState>({ kind: "idle" });

  useEffect(() => {
    if (!active) {
      setState({ kind: "idle" });
      return;
    }
    // One fetch per activation per URL. state.kind is deliberately not
    // a dependency: setting "loading" would re-run the effect and its
    // cleanup would abort the fetch just started.
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(`/api/help?pathname=${encodeURIComponent(pathname)}`, { signal: controller.signal })
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
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : "Failed to load help." });
      });
    return () => controller.abort();
  }, [active, pathname]);

  return state;
}
