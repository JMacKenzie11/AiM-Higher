"use client";

import { useState, useTransition } from "react";
import {
  pauseSourceAction,
  resumeSourceAction,
  removeSourceAction,
  checkSourceNowAction,
  analyzePendingForCompanyAction,
} from "@/lib/transcripts/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { TranscriptSourceStatus } from "@/lib/types";
import styles from "../companies/admin.module.css";

// Row-level actions for a transcript source.
//
// "Check now" is a two-phase flow so the operator gets progressive
// feedback instead of a mystery pause:
//   1. Ingest — usually <5s. Reports "Found N new" and revalidates
//      so any new meetings appear as pending in the table below.
//   2. Analyze — slower. Reports "Analyzing N…" during the run and
//      "Analyzed N" on success. Between the two, the Recent
//      meetings table updates from pending → analyzing → complete
//      as revalidation catches each transition.

export function SourceRowActions({
  sourceId,
  companyId,
  status,
}: {
  sourceId: string;
  companyId: string;
  status: TranscriptSourceStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"info" | "success" | "error">("info");
  const [confirmRemove, setConfirmRemove] = useState(false);

  function report(text: string, tone: "info" | "success" | "error" = "info") {
    setMsg(text);
    setMsgTone(tone);
  }

  function runSimple(
    fn: () => Promise<{ ok: true } | { ok: false; message: string }>
  ) {
    report("");
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) report(r.message, "error");
    });
  }

  function runCheckNow() {
    startTransition(async () => {
      report("Checking Drive for new transcripts…", "info");
      const ingest = await checkSourceNowAction(sourceId);
      if (!ingest.ok) {
        report(ingest.message, "error");
        return;
      }
      if (ingest.filesIngested === 0) {
        report("No new transcripts.", "success");
        return;
      }
      report(
        `Found ${ingest.filesIngested} new transcript${ingest.filesIngested === 1 ? "" : "s"} — analyzing…`,
        "info"
      );
      const analysis = await analyzePendingForCompanyAction(companyId);
      if (!analysis.ok) {
        report(`Ingested but analysis failed: ${analysis.message}`, "error");
        return;
      }
      report(
        `Analyzed ${analysis.analyzed} meeting${analysis.analyzed === 1 ? "" : "s"}.`,
        "success"
      );
    });
  }

  const msgStyle =
    msgTone === "error"
      ? styles.inlineError
      : msgTone === "success"
        ? styles.successMessage
        : styles.subtitleInline;

  return (
    <div className={styles.actionsCell}>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={runCheckNow}
        disabled={pending}
      >
        {pending ? "Working…" : "Check now"}
      </button>
      {status === "paused" ? (
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => runSimple(() => resumeSourceAction(sourceId))}
          disabled={pending}
        >
          Resume
        </button>
      ) : (
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => runSimple(() => pauseSourceAction(sourceId))}
          disabled={pending}
        >
          Pause
        </button>
      )}
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => setConfirmRemove(true)}
        disabled={pending}
      >
        Remove
      </button>
      {msg ? <p className={msgStyle}>{msg}</p> : null}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove this source?"
        message="Every meeting analyzed from this folder will be deleted with it. Meetings routed to other companies via aliases are not affected."
        confirmLabel="Remove source"
        tone="danger"
        onConfirm={() => {
          setConfirmRemove(false);
          runSimple(() => removeSourceAction(sourceId));
        }}
        onCancel={() => setConfirmRemove(false)}
        pending={pending}
      />
    </div>
  );
}
