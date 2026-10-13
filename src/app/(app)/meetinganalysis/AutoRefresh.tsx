"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// While an analysis runs, look again every 5 seconds, so its status
// moves from Queued to Analyzing to Ready on screen without anybody
// pressing refresh. Rendered only while something is running: once
// nothing is, the page stops asking.
//
// Not while the tab is hidden, and once straight away when it comes
// back, so a report that finished in the background shows at once.
export function AutoRefresh({ everyMs = 5_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = setInterval(tick, everyMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, everyMs]);
  return null;
}
