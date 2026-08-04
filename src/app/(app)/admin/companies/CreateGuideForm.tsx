"use client";

import { useActionState, useState } from "react";
import {
  createGuideAction,
  type GuideActionResult,
} from "@/lib/admin/guides-actions";
import type { Company } from "@/lib/types";
import styles from "./admin.module.css";

// Create-a-guide form. At least one company assignment is required
// up front — the enforcement lives in the server action too, this is
// just the fast-fail UX.

const INITIAL: GuideActionResult = { ok: false, message: "" };

// useActionState wants `(state, payload) => next state`, but our
// server action only cares about the FormData payload. Adapt with a
// prev-swallowing wrapper.
async function createGuideActionState(
  _prev: GuideActionResult,
  formData: FormData
): Promise<GuideActionResult> {
  return createGuideAction(formData);
}

export function CreateGuideForm({
  companies,
}: {
  companies: Pick<Company, "id" | "name">[];
}) {
  const [state, formAction, pending] = useActionState<
    GuideActionResult,
    FormData
  >(createGuideActionState, INITIAL);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const successMessage =
    state && "ok" in state && state.ok ? "Guide created." : null;

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="guide-name" className={styles.label}>
          Full name
        </label>
        <input
          id="guide-name"
          name="full_name"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="guide-email" className={styles.label}>
          Email
        </label>
        <input
          id="guide-email"
          name="email"
          type="email"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="guide-position" className={styles.label}>
          Position
        </label>
        <input
          id="guide-position"
          name="position"
          className={styles.input}
          placeholder="Coach title (optional)"
          disabled={pending}
        />
      </div>

      <fieldset className={`${styles.field} ${styles.formFull}`}>
        <legend className={styles.label}>
          Assigned companies (at least one)
        </legend>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          {companies.map((c) => {
            const checked = selectedCompanies.includes(c.id);
            return (
              <label
                key={c.id}
                className={styles.checkOption}
                style={{ margin: 0 }}
              >
                <input
                  type="checkbox"
                  name="company_id"
                  value={c.id}
                  checked={checked}
                  disabled={pending}
                  onChange={(e) => {
                    setSelectedCompanies((prev) =>
                      e.target.checked
                        ? [...prev, c.id]
                        : prev.filter((id) => id !== c.id)
                    );
                  }}
                />
                {c.name}
              </label>
            );
          })}
        </div>
      </fieldset>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p role="status" className={styles.successMessage}>
          {successMessage}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending || selectedCompanies.length === 0}
        >
          {pending ? "Adding…" : "Add guide"}
        </button>
      </div>
    </form>
  );
}
