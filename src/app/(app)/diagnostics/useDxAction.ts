"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DxResult } from "@/lib/diagnostics/actions";
import { useSaveReport } from "./[id]/SaveStatus";

// Runs one diagnostic action: pending while it runs, the message when
// it is refused, and a refresh when it saves so the server-rendered
// figures follow. On a guided screen it reports itself to the screen's
// save status ([id]/SaveStatus.tsx) while it runs.
export function useDxAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useSaveReport({ pending, dirty: false });

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
