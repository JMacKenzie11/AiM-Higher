"use client";

import { useActionState } from "react";
import {
  createCompanyAction,
  type CompanyResult,
} from "@/lib/companies/actions";
import styles from "./admin.module.css";

const INITIAL: CompanyResult = { ok: false, message: "" };

export function CreateCompanyForm() {
  const [state, formAction, pending] = useActionState<
    CompanyResult,
    FormData
  >(createCompanyAction, INITIAL);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const succeeded = state && "ok" in state && state.ok && !pending;

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="company-name" className={styles.label}>
          Company name
        </label>
        <input
          id="company-name"
          name="name"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="company-timezone" className={styles.label}>
          Timezone
        </label>
        <select
          id="company-timezone"
          name="timezone"
          defaultValue="America/Anchorage"
          className={styles.select}
          disabled={pending}
        >
          {/* ASSUMPTION: v1 offers common US business timezones. If a
              client needs another, edit the row directly in Supabase for
              now; a full IANA picker can land in Phase 9 polish. */}
          <option value="America/Anchorage">America/Anchorage — Alaska</option>
          <option value="America/Los_Angeles">America/Los_Angeles — Pacific</option>
          <option value="America/Denver">America/Denver — Mountain</option>
          <option value="America/Phoenix">America/Phoenix — Arizona (no DST)</option>
          <option value="America/Chicago">America/Chicago — Central</option>
          <option value="America/New_York">America/New_York — Eastern</option>
          <option value="America/Halifax">America/Halifax — Atlantic</option>
          <option value="Pacific/Honolulu">Pacific/Honolulu — Hawaii</option>
          <option value="UTC">UTC</option>
        </select>
      </div>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}
      {succeeded ? (
        <p role="status" className={styles.successMessage}>
          Company created.
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Creating…" : "Create company"}
        </button>
      </div>
    </form>
  );
}
