"use client";

import { useActionState } from "react";
import {
  openQuarterAction,
  type QuarterResult,
} from "@/lib/quarters/actions";
import styles from "./quarters.module.css";

const INITIAL: QuarterResult = { ok: false, message: "" };

export type OpenQuarterFormProps = {
  defaultLabel: string;
  defaultStart: string;
  defaultEnd: string;
  companyId?: string;
};

export function OpenQuarterForm({
  defaultLabel,
  defaultStart,
  defaultEnd,
  companyId,
}: OpenQuarterFormProps) {
  const [state, formAction, pending] = useActionState<
    QuarterResult,
    FormData
  >(openQuarterAction, INITIAL);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const success = state && "ok" in state && state.ok;

  return (
    <form action={formAction} className={styles.form}>
      {companyId ? (
        <input type="hidden" name="company_id" value={companyId} />
      ) : null}

      <div className={styles.field}>
        <label htmlFor="q-label" className={styles.label}>
          Label
        </label>
        <input
          id="q-label"
          name="label"
          defaultValue={defaultLabel}
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="q-start" className={styles.label}>
          Start date
        </label>
        <input
          id="q-start"
          name="start_date"
          type="date"
          defaultValue={defaultStart}
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="q-end" className={styles.label}>
          End date
        </label>
        <input
          id="q-end"
          name="end_date"
          type="date"
          defaultValue={defaultEnd}
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      {success && !pending ? (
        <p role="status" className={styles.successMessage}>
          Quarter opened. It&rsquo;s now the current quarter.
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Opening…" : "Open quarter"}
        </button>
      </div>
    </form>
  );
}
