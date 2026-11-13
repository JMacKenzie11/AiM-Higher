"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  uploadTranscriptAction,
  type UploadTranscriptState,
} from "@/lib/transcripts/upload-action";
import styles from "../admin/companies/admin.module.css";
import lead from "../meetinganalysis/lead.module.css";

// Upload a transcript on Meeting Summaries. Rendered only for the
// people the action admits (system admin, the company's admin, an
// assigned guide, the AiMS champion); the action checks again.

// A server action's request body is capped at 1 MB. A larger file is
// refused here with a sentence rather than by the framework.
const MAX_FILE_BYTES = 900_000;

export function UploadTranscriptForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState<UploadTranscriptState, FormData>(
    uploadTranscriptAction,
    null
  );
  const [fileError, setFileError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className={styles.form}
      onSubmit={(e) => {
        const input = e.currentTarget.elements.namedItem("transcript_file") as HTMLInputElement | null;
        const file = input?.files?.[0];
        if (file && file.size > MAX_FILE_BYTES) {
          e.preventDefault();
          setFileError("That file is too large to upload. Paste the transcript text instead.");
        } else {
          setFileError(null);
        }
      }}
    >
      <label className={styles.field}>
        <span className={styles.label}>Meeting name</span>
        <input
          name="meeting_title"
          className={styles.input}
          placeholder="Optional. Taken from the transcript if left blank."
          autoComplete="off"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Held on</span>
        <input name="meeting_date" type="date" className={styles.input} defaultValue={today} max={today} required />
      </label>

      <div className={`${styles.field} ${styles.formFull}`}>
        <label className={styles.label} htmlFor="transcript_file">
          Transcript
        </label>
        <input
          id="transcript_file"
          name="transcript_file"
          type="file"
          accept=".docx,.txt,.vtt,text/plain,text/vtt,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className={lead.file}
        />
        <p className={lead.or}>Or paste it here. An uploaded file is used when there are both.</p>
        <textarea name="transcript_text" className={lead.textarea} aria-label="Transcript text" />
      </div>

      {fileError ? (
        <p className={styles.errorMessage}>{fileError}</p>
      ) : state && !state.ok ? (
        <p className={styles.errorMessage}>{state.message}</p>
      ) : state?.ok ? (
        <p role="status" className={styles.fieldHint}>
          {state.title} is being analysed. It appears below now and is ready in a few minutes.
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button type="submit" className={styles.primaryButton} disabled={pending}>
          {pending ? "Uploading..." : "Analyse meeting"}
        </button>
        <span className={styles.fieldHint}>A .docx, .txt or .vtt file. The analysis takes a few minutes.</span>
      </div>
    </form>
  );
}
