"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  uploadCoachingCallAction,
  uploadTranscriptAction,
  type UploadTranscriptState,
} from "@/lib/transcripts/upload-action";
import styles from "../admin/companies/admin.module.css";
import up from "./upload.module.css";

// Upload a transcript on Meeting Summaries: one row of name, date,
// file and button. Rendered only for the people the action admits
// (system admin, the company's admin, an assigned guide, the AiMS
// champion); the action checks again.
//
// The same form adds a coaching call on the Coaching calls tab
// (kind="coaching", 0326), for the company's coach and its AiMS
// Champion only; the action checks that too.

// A server action's request body is capped at 1 MB. A larger file is
// refused here with a sentence rather than by the framework.
const MAX_FILE_BYTES = 900_000;

export function UploadTranscriptForm({
  today,
  kind = "team",
  companies,
}: {
  today: string;
  kind?: "team" | "coaching";
  // Coach HQ: the coach chooses the company on the form, which then
  // goes to uploadCoachingCallAction (an assigned coach only). A
  // coaching call always.
  companies?: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<UploadTranscriptState, FormData>(
    companies ? uploadCoachingCallAction : uploadTranscriptAction,
    null
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const coaching = kind === "coaching" || Boolean(companies);
  // Two of these can share a page (one per tab), so ids are per kind.
  const fileId = companies ? "hq_call_file" : coaching ? "coaching_call_file" : "transcript_file";

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setFileName(null);
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(e) => {
        const input = e.currentTarget.elements.namedItem("transcript_file") as HTMLInputElement | null;
        const file = input?.files?.[0];
        if (!file) {
          e.preventDefault();
          setFileError("Choose a transcript file first.");
        } else if (file.size > MAX_FILE_BYTES) {
          e.preventDefault();
          setFileError("That file is too large to upload.");
        } else {
          setFileError(null);
        }
      }}
    >
      <input type="hidden" name="kind" value={coaching ? "coaching" : "team"} />
      <div className={up.row}>
        {companies ? (
          <label className={`${styles.field} ${up.name}`}>
            <span className={styles.label}>Company</span>
            <select name="company_id" className={styles.input} required defaultValue="">
              <option value="" disabled>
                Choose a company
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={`${styles.field} ${up.name}`}>
          <span className={styles.label}>{coaching ? "Call name" : "Meeting name"}</span>
          <input
            name="meeting_title"
            className={styles.input}
            placeholder="Optional"
            autoComplete="off"
          />
        </label>
        <label className={`${styles.field} ${up.date}`}>
          <span className={styles.label}>Held on</span>
          <input name="meeting_date" type="date" className={styles.input} defaultValue={today} max={today} required />
        </label>
        <div className={up.file}>
          <input
            id={fileId}
            name="transcript_file"
            type="file"
            accept=".docx,.txt,.vtt,text/plain,text/vtt,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className={up.hiddenInput}
            onChange={(e) => {
              setFileName(e.currentTarget.files?.[0]?.name ?? null);
              setFileError(null);
            }}
          />
          <label htmlFor={fileId} className={styles.ghostButton}>
            Choose file
          </label>
          <span className={up.fileName}>{fileName ?? ".docx, .txt or .vtt"}</span>
        </div>
        <button type="submit" className={styles.primaryButton} disabled={pending || !fileName}>
          {pending ? "Uploading..." : coaching ? "Add call" : "Analyse meeting"}
        </button>
      </div>

      {fileError ? (
        <p className={`${styles.errorMessage} ${up.message}`}>{fileError}</p>
      ) : state && !state.ok ? (
        <p className={`${styles.errorMessage} ${up.message}`}>{state.message}</p>
      ) : state?.ok ? (
        <p role="status" className={`${styles.fieldHint} ${up.message}`}>
          {state.title} is being analysed. It appears below now and is ready in a few minutes.
        </p>
      ) : null}
    </form>
  );
}
