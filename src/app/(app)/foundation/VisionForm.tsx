"use client";

import { useActionState } from "react";
import {
  upsertFoundationAction,
  type Result,
} from "@/lib/foundation/actions";
import type { CompanyFoundation } from "@/lib/types";
import styles from "./foundation.module.css";

const INITIAL: Result<CompanyFoundation> = { ok: false, message: "" };

// Single vision field — title, tagline, body, and the old milestone
// list all consolidated (migration 0106).

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
        <label htmlFor="vision" className={styles.label}>
          Vision
        </label>
        <textarea
          id="vision"
          name="vision"
          className={styles.textarea}
          defaultValue={foundation?.vision ?? ""}
          rows={12}
          placeholder="Where this company is going. Title, tagline, milestones — all of it belongs here, in your own words."
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
