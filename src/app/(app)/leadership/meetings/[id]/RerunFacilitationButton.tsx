"use client";

import { useState, useTransition } from "react";
import { rerunFacilitationReviewAction } from "@/lib/leadership/facilitation/rerun";

// Admin-only affordance on the meeting detail page. Fires the
// facilitation-only re-run action (NOT the full analyzer — commitments
// won't be duplicated). Shows inline pending / success / error text so
// admins get feedback without a page-level flash.

export function RerunFacilitationButton({ meetingId }: { meetingId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");

  function onClick() {
    setMessage(null);
    setStatus("idle");
    startTransition(async () => {
      const result = await rerunFacilitationReviewAction(meetingId);
      if (result.ok) {
        setStatus("ok");
        if (result.insufficient) {
          setMessage(
            "Facilitation review updated — model flagged the transcript as insufficient, so no score was recorded."
          );
        } else if (result.overall == null) {
          setMessage("Facilitation review updated — no overall score returned.");
        } else {
          setMessage(`Facilitation review updated (${result.overall}/10).`);
        }
      } else {
        setStatus("err");
        setMessage(result.message);
      }
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        style={{
          padding: "var(--space-2) var(--space-4)",
          background: "var(--primary, #3551A4)",
          color: "var(--aims-white, #fff)",
          border: "none",
          borderRadius: "var(--radius-md, 8px)",
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          fontWeight: 600,
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? "Re-running…" : "Re-run facilitation review"}
      </button>
      {message ? (
        <span
          role="status"
          style={{
            fontSize: "13px",
            color:
              status === "ok"
                ? "var(--aims-good-fg, #166534)"
                : "var(--aims-bad-fg, #991b1b)",
          }}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
