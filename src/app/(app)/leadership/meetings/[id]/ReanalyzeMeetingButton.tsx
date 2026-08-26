"use client";

import { useState, useTransition } from "react";
import { reanalyzeMeetingAction } from "@/lib/transcripts/reanalyze-action";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// Admin/guide affordance to rerun the analysis pipeline on this
// meeting. Wipes the current analysis + any auto-created
// commitments + any issues sourced from the meeting, then fires
// the extraction in the background. User refreshes the page in
// ~30-90s to see the new analysis.
//
// Confirm dialog spells out the delete count so a reader doesn't
// accidentally nuke a chunk of active work.

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
        const parts: string[] = [];
        if (result.deletedCommitments > 0) {
          parts.push(
            `${result.deletedCommitments} commitment${
              result.deletedCommitments === 1 ? "" : "s"
            }`
          );
        }
        if (result.deletedIssues > 0) {
          parts.push(
            `${result.deletedIssues} issue${
              result.deletedIssues === 1 ? "" : "s"
            }`
          );
        }
        const removed = parts.length > 0 ? ` Removed ${parts.join(" + ")}.` : "";
        setMessage(
          `Reset — reanalysis running now.${removed} Refresh in 30-90 seconds.`
        );
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
        style={{
          padding: "var(--space-2) var(--space-4)",
          background: "transparent",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md, 8px)",
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          fontWeight: 500,
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
        }}
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
                ? "var(--aims-success, #166534)"
                : "var(--aims-danger, #991b1b)",
          }}
        >
          {message}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title="Reanalyze this meeting?"
        message="Deletes the current analysis, any commitments that were auto-created from this meeting, and any issues added from it. Reanalysis runs in the background — refresh the page in about a minute to see the new output."
        confirmLabel="Reanalyze"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
    </div>
  );
}
