"use client";

import { useState, useTransition } from "react";
import { reanalyzeMeetingAction } from "@/lib/transcripts/reanalyze-action";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import uiStyles from "@/components/ui/ui.module.css";

// System-admin affordance to rerun the analysis on a meeting that has
// no commitments or issues from it. The page only renders this when
// both hold; the action refuses otherwise. See reanalyze-action.ts.

export function ReanalyzeMeetingButton({ meetingId }: { meetingId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");

  function run() {
    setConfirming(false);
    setMessage(null);
    setStatus("idle");
    startTransition(async () => {
      const result = await reanalyzeMeetingAction(meetingId);
      if (result.ok) {
        setStatus("ok");
        setMessage("Reanalysis running now. Refresh in 30 to 90 seconds.");
      } else {
        setStatus("err");
        setMessage(result.message);
      }
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className={uiStyles.btnGhost}
      >
        {pending ? "Resetting…" : "Reanalyze meeting"}
      </button>
      {message ? (
        <span
          role="status"
          style={{
            fontSize: "13px",
            color:
              status === "ok"
                ? "var(--aims-success)"
                : "var(--aims-danger)",
          }}
        >
          {message}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title="Reanalyze this meeting?"
        message="Replaces the current analysis. This meeting has no commitments or issues, so nothing else changes. It runs in the background: refresh the page in about a minute to see the new output."
        confirmLabel="Reanalyze"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
    </div>
  );
}
