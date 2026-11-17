"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkDrawer } from "./context";

// ?open=<commitment id> opens that commitment's drawer on arrival:
// where a commitment in the weekly meeting email leads (2026-11-17).
// On /commitments and on /issues, whose open issues carry their
// commitments with them.
//
// The rows register themselves in their own effects, and this is a
// sibling of them, not a parent, so it cannot count on running after
// them. It waits for the commitment to be known, for a few seconds at
// most: one that is not on the page (another company's, or deleted)
// simply opens nothing.
//
// Once opened, ?open= comes off the address, so a refresh or a Back
// to this page does not open the drawer again.
const WAIT_MS = 4000;

export function OpenCommitmentFromLink() {
  const params = useSearchParams();
  const id = params.get("open");
  const drawer = useWorkDrawer();
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!id || !drawer || done.current === id) return;
    const started = Date.now();
    let frame = 0;
    const tryOpen = () => {
      if (drawer.hasCommitment(id)) {
        done.current = id;
        const row = document.querySelector<HTMLElement>(
          `[data-commitment-id="${CSS.escape(id)}"]`
        );
        row?.scrollIntoView({ block: "center" });
        drawer.openCommitment(id, row);
        const url = new URL(window.location.href);
        url.searchParams.delete("open");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        return;
      }
      if (Date.now() - started < WAIT_MS) frame = requestAnimationFrame(tryOpen);
    };
    tryOpen();
    return () => cancelAnimationFrame(frame);
  }, [id, drawer]);

  return null;
}
