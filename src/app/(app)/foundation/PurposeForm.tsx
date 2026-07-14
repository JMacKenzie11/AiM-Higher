"use client";

import { useActionState } from "react";
import {
  upsertFoundationAction,
  type Result,
} from "@/lib/foundation/actions";
import type { CompanyFoundation } from "@/lib/types";
import styles from "./foundation.module.css";

const INITIAL: Result<CompanyFoundation> = { ok: false, message: "" };

export function PurposeForm({
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
        <label htmlFor="purpose-statement" className={styles.label}>
          Purpose statement
        </label>
        <textarea
          id="purpose-statement"
          name="purpose_statement"
          className={styles.textarea}
          defaultValue={foundation?.purpose_statement ?? ""}
          rows={3}
          placeholder="One or two sentences on why this company exists."
          disabled={pending}
        />
      </div>

      <div className={styles.fieldWide}>
        <label htmlFor="purpose-context" className={styles.label}>
          Context (paragraph above the statement)
        </label>
        <textarea
          id="purpose-context"
          name="purpose_context"
          className={styles.textarea}
          defaultValue={foundation?.purpose_context ?? ""}
          rows={3}
          disabled={pending}
        />
      </div>

      {/* Vision fields live in the Vision tab's form; the singleton
          shares the same row, so both forms include only the fields
          they own and leave the rest untouched via upsert semantics.
          To do that safely, we send the current vision values so the
          upsert doesn't null them out. */}
      <input
        type="hidden"
        name="vision_title"
        value={foundation?.vision_title ?? ""}
      />
      <input
        type="hidden"
        name="vision_tagline"
        value={foundation?.vision_tagline ?? ""}
      />
      <input
        type="hidden"
        name="vision_body"
        value={foundation?.vision_body ?? ""}
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
          {pending ? "Saving…" : "Save purpose"}
        </button>
      </div>
    </form>
  );
}
