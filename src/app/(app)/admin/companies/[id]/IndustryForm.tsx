"use client";

import { useState, useTransition } from "react";
import { setCompanyIndustryAction } from "@/lib/companies/actions";
import styles from "../admin.module.css";

export function IndustryForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: string | null;
}) {
  const [value, setValue] = useState<string>(initial ?? "");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const dirty = (value.trim() || null) !== (initial ?? null);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setCompanyIndustryAction(
        companyId,
        value.trim() || null
      );
      if (result.ok) {
        setMessage({ ok: true, text: "Industry updated." });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div className={styles.form}>
      <div className={`${styles.field} ${styles.formFull}`}>
        <label htmlFor="company-industry-edit" className={styles.label}>
          Industry
        </label>
        <input
          id="company-industry-edit"
          className={styles.input}
          value={value}
          onChange={(e) => {
            setMessage(null);
            setValue(e.target.value);
          }}
          placeholder="e.g. Construction, SaaS, Healthcare"
          disabled={pending}
        />
      </div>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? styles.successMessage : styles.errorMessage}
        >
          {message.text}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={save}
          disabled={pending || !dirty}
        >
          {pending ? "Saving…" : "Save industry"}
        </button>
      </div>
    </div>
  );
}
