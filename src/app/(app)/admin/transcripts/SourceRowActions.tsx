"use client";

import { useState, useTransition } from "react";
import {
  pauseSourceAction,
  resumeSourceAction,
  removeSourceAction,
  checkSourceNowAction,
} from "@/lib/transcripts/actions";
import type { TranscriptSourceStatus } from "@/lib/types";
import styles from "../companies/admin.module.css";

export function SourceRowActions({
  sourceId,
  status,
}: {
  sourceId: string;
  status: TranscriptSourceStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setMsg(r.message);
    });
  }

  return (
    <div className={styles.actionsCell}>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={() => run(() => checkSourceNowAction(sourceId))}
        disabled={pending}
      >
        Check now
      </button>
      {status === "paused" ? (
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => run(() => resumeSourceAction(sourceId))}
          disabled={pending}
        >
          Resume
        </button>
      ) : (
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => run(() => pauseSourceAction(sourceId))}
          disabled={pending}
        >
          Pause
        </button>
      )}
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          if (!confirm("Remove this source? Meetings from it will be deleted.")) return;
          run(() => removeSourceAction(sourceId));
        }}
        disabled={pending}
      >
        Remove
      </button>
      {msg ? <p className={styles.inlineError}>{msg}</p> : null}
    </div>
  );
}
