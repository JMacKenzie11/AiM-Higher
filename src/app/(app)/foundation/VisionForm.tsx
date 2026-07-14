"use client";

import { useActionState } from "react";
import {
  upsertFoundationAction,
  type Result,
} from "@/lib/foundation/actions";
import type { CompanyFoundation } from "@/lib/types";
import styles from "./foundation.module.css";

const INITIAL: Result<CompanyFoundation> = { ok: false, message: "" };

export function VisionForm({
  foundation,
}: {
  foundation: CompanyFoundation | null;
}) {
  const [state, formAction, pending] = useActionState<
    Result<CompanyFoundation>,
    FormData
  >(upsertFoundationAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.fieldWide}>
        <label htmlFor="vision-title" className={styles.label}>
          Vision title
        </label>
        <input
          id="vision-title"
          name="vision_title"
          className={styles.input}
          defaultValue={foundation?.vision_title ?? ""}
          placeholder="e.g. Vision 2035: Powering Alaska's Future"
          disabled={pending}
        />
      </div>
      <div className={styles.fieldWide}>
        <label htmlFor="vision-tagline" className={styles.label}>
          Tagline
        </label>
        <input
          id="vision-tagline"
          name="vision_tagline"
          className={styles.input}
          defaultValue={foundation?.vision_tagline ?? ""}
          placeholder="e.g. big enough to lead, yet small enough to care"
          disabled={pending}
        />
      </div>
      <div className={styles.fieldWide}>
        <label htmlFor="vision-body" className={styles.label}>
          Narrative
        </label>
        <textarea
          id="vision-body"
          name="vision_body"
          className={styles.textarea}
          defaultValue={foundation?.vision_body ?? ""}
          rows={6}
          disabled={pending}
        />
      </div>

      {/* Preserve purpose fields on upsert (same singleton row). */}
      <input
        type="hidden"
        name="purpose_statement"
        value={foundation?.purpose_statement ?? ""}
      />
      <input
        type="hidden"
        name="purpose_context"
        value={foundation?.purpose_context ?? ""}
      />

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save vision"}
        </button>
      </div>
    </form>
  );
}
