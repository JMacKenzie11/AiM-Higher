"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DxResult } from "@/lib/diagnostics/actions";

// Runs one diagnostic action: pending while it runs, the message when
// it is refused, and a refresh when it saves so the server-rendered
// figures follow.
export function useDxAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function run(fn: () => Promise<DxResult>, then?: (r: DxResult & { ok: true }) => void) {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setSaved(true);
      if (then) then(r);
      router.refresh();
    });
  }

  return { pending, error, saved, run, setError };
}
