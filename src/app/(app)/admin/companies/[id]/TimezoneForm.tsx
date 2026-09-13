"use client";

import { useState, useTransition } from "react";
import { setCompanyTimezoneAction } from "@/lib/companies/actions";
import { COMPANY_TIMEZONES } from "@/lib/companies/timezones";
import styles from "../admin.module.css";

export function TimezoneForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: string;
}) {
  const [value, setValue] = useState<string>(initial);
  const [saved, setSaved] = useState<string>(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  // A company whose row was set by hand to a zone that is not on the
  // list still has to render as what it is. Without this the select
  // would snap to the first option and the first save would move a
  // clock nobody meant to touch.
  const known = COMPANY_TIMEZONES.some((t) => t.value === saved);
  const options = known
    ? COMPANY_TIMEZONES
    : [{ value: saved, label: `${saved} (not on the standard list)` }, ...COMPANY_TIMEZONES];

  const dirty = value !== saved;

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setCompanyTimezoneAction(companyId, value);
      if (result.ok) {
        setSaved(result.company.timezone);
        setMessage({ ok: true, text: "Timezone updated." });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div className={styles.form}>
      <div className={`${styles.field} ${styles.formFull}`}>
        <label htmlFor="company-timezone-edit" className={styles.label}>
          Timezone
        </label>
        <select
          id="company-timezone-edit"
          className={styles.select}
          value={value}
          onChange={(e) => {
            setMessage(null);
            setValue(e.target.value);
          }}
          disabled={pending}
        >
          {options.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {dirty ? (
        <p role="status" className={styles.subtitleInline}>
          Scorecards, snapshots and follow-through all bucket by date in
          this clock. Moving it re-dates history: counts either side of
          the old midnight will read differently afterwards. The change
          is recorded with your name against it.
        </p>
      ) : null}

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
          {pending ? "Saving…" : "Save timezone"}
        </button>
      </div>
    </div>
  );
}
