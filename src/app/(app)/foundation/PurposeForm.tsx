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

      {/* Vision lives in the Vision form; the singleton shares the
          same row, so each form includes only the fields it owns and
          preserves the rest via upsert semantics. */}
      <input
        type="hidden"
        name="vision"
        value={foundation?.vision ?? ""}
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
