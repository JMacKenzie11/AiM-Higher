"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createLeadAnalysisAction, type LeadActionState } from "@/lib/lead-analysis/actions";
import styles from "../admin/companies/admin.module.css";
import lead from "./lead.module.css";

// A server action's request body is capped at 1 MB. A transcript file
// is far smaller than that; a larger one is refused here with a
// sentence rather than by the framework with an error page.
const MAX_FILE_BYTES = 900_000;

export function NewLeadAnalysisForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LeadActionState, FormData>(
    createLeadAnalysisAction,
    null
  );
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) router.push(`/meetinganalysis/${state.id}`);
  }, [state, router]);

  return (
    <form
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
        <span className={styles.label}>Name</span>
        <input name="full_name" className={styles.input} required autoComplete="off" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input name="email" type="email" className={styles.input} required autoComplete="off" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Company</span>
        <input name="company_name" className={styles.input} required autoComplete="off" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Role</span>
        <input name="role_title" className={styles.input} placeholder="e.g. CEO" autoComplete="off" />
      </label>

      <div className={`${styles.field} ${styles.formFull}`}>
        <label className={styles.label} htmlFor="transcript_file">
          Transcript
        </label>
        <input
          id="transcript_file"
          name="transcript_file"
          type="file"
          accept=".txt,.vtt,.docx,text/plain,text/vtt,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className={lead.file}
        />
        <p className={lead.or}>Or paste it here. An uploaded file is used when there are both.</p>
        <textarea
          name="transcript_text"
          className={lead.textarea}
          aria-label="Transcript text"
        />
      </div>

      {fileError ? (
        <p className={styles.errorMessage}>{fileError}</p>
      ) : state && !state.ok ? (
        <p className={styles.errorMessage}>{state.message}</p>
      ) : null}

      <div className={styles.submitRow}>
        <button type="submit" className={styles.primaryButton} disabled={pending}>
          {pending ? "Starting..." : "Analyze Meeting"}
        </button>
        <span className={styles.fieldHint}>The analysis takes two to four minutes.</span>
      </div>
    </form>
  );
}
