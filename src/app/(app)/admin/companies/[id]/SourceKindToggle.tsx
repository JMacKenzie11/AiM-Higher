"use client";

import { useState, useTransition } from "react";
import { setSourceKindAction } from "@/lib/transcripts/actions";
import ui from "@/components/ui/ui.module.css";
import styles from "../admin.module.css";

// Mark a folder or Teams meeting as coaching calls, or back (0326).
// Rendered for the company's assigned coach only; the action and the
// database check again.
export function SourceKindToggle({
  sourceId,
  kind,
}: {
  sourceId: string;
  kind: "team" | "coaching";
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next = kind === "coaching" ? "team" : "coaching";
  return (
    <>
      <button
        type="button"
        className={`${ui.btn} ${ui.btnGhost} ${ui.btnSm}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setSourceKindAction(sourceId, next);
            setError(res.ok ? null : res.message);
          })
        }
      >
        {kind === "coaching" ? "Mark as team meetings" : "Mark as coaching calls"}
      </button>
      {error ? <span className={styles.inlineError}>{error}</span> : null}
    </>
  );
}
