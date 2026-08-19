"use client";

import { useRef, useState, useTransition } from "react";
import { assignExistingAsGuideAction } from "@/lib/admin/guides-actions";
import type { Company, Profile } from "@/lib/types";
import styles from "./admin.module.css";

// Mini-form that gives a system admin a coaching caseload. Unlike
// CreateGuideForm, no invite is sent and no auth user is created —
// the sysadmin already exists. The picker is only useful when there's
// at least one sysadmin profile to assign, so the parent renders it
// conditionally.
//
// Assignments are additive: submitting for a sysadmin who already
// coaches other companies tops up their list; the server upserts so
// re-picking an already-assigned company is a no-op.

type CaseloadCandidate = Pick<Profile, "id" | "full_name">;

export function AssignSysadminForm({
  sysadmins,
  companies,
}: {
  sysadmins: CaseloadCandidate[];
  companies: Pick<Company, "id" | "name">[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (sysadmins.length === 0) return null;
  if (companies.length === 0) return null;

  return (
    <form
      ref={formRef}
      className={styles.assignSysadminForm}
      action={(fd) => {
        setMsg(null);
        setOk(false);
        startTransition(async () => {
          const r = await assignExistingAsGuideAction(fd);
          if (!r.ok) {
            setMsg(r.message);
            return;
          }
          setOk(true);
          formRef.current?.reset();
        });
      }}
    >
      <div className={styles.assignSysadminRow}>
        <label className={styles.assignSysadminField}>
          <span className={styles.assignSysadminLabel}>System admin</span>
          <select name="guide_id" required disabled={pending} className={styles.select}>
            <option value="">Pick a system admin…</option>
            {sysadmins.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className={styles.assignSysadminCompanies}>
          <legend className={styles.assignSysadminLabel}>Companies</legend>
          <div className={styles.assignSysadminCompanyList}>
            {companies.map((c) => (
              <label key={c.id} className={styles.assignSysadminCompanyItem}>
                <input
                  type="checkbox"
                  name="company_id"
                  value={c.id}
                  disabled={pending}
                />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className={styles.assignSysadminActions}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Assigning…" : "Add to caseload"}
        </button>
        {ok ? (
          <span className={styles.assignSysadminOk} role="status">
            Assigned.
          </span>
        ) : null}
        {msg ? <span className={styles.inlineError}>{msg}</span> : null}
      </div>
    </form>
  );
}
