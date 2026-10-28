"use client";

import { useState, useTransition } from "react";
import { retryFailedMeetingAction } from "@/lib/transcripts/reanalyze-action";
import styles from "../admin/companies/admin.module.css";

// Try again on a failed row of Meeting Summaries. The list renders it
// only for the people who manage the company's meetings and only on a
// meeting that can be retried; the action checks both again and runs
// the same path as Reanalyze meeting. On success the page revalidates
// and the row comes back as pending, so the button goes away.

export function RetryFailedMeetingButton({ meetingId }: { meetingId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const result = await retryFailedMeetingAction(meetingId);
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={styles.ghostButton}
      >
        {pending ? "Starting…" : "Try again"}
      </button>
      {message ? (
        <span role="status" style={{ fontSize: "13px", color: "var(--aims-danger)" }}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
