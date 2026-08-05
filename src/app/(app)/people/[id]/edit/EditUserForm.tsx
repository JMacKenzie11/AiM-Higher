"use client";

import { useActionState } from "react";
import { updateUserAction, type UserActionResult } from "@/lib/auth/users";
import type { Profile } from "@/lib/types";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "@/app/(app)/admin/companies/admin.module.css";

// Admin form for editing a person's basic profile + email. Role
// options adapt to the caller: company admins can promote to
// company_admin but not sysadmin or guide.

type Role = Profile["role"];

const INITIAL: UserActionResult = { ok: false, message: "" };

export function EditUserForm({
  subject,
  initialEmail,
  roster,
  callerRole,
  readOnly = false,
}: {
  subject: Profile;
  initialEmail: string;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  callerRole: Role;
  // When true, all inputs are disabled and the Save button is
  // hidden. Used on the person scorecard for non-admin viewers so
  // Details renders as a read-only reference block, not a form.
  readOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    UserActionResult,
    FormData
  >(updateUserAction, INITIAL);
  const disabled = pending || readOnly;

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const success = state && "ok" in state && state.ok && !pending;

  const canGrantAdmin = callerRole === "system_admin";
  const roleOptions: Array<{ value: Role; label: string }> = [
    { value: "team_member", label: "Team member" },
    { value: "company_admin", label: "Company admin" },
  ];
  if (canGrantAdmin) {
    roleOptions.push({ value: "system_admin", label: "System admin" });
    roleOptions.push({ value: "aims_guide", label: "AiMS guide" });
  }

  const firstName = subject.first_name ?? subject.full_name.split(" ")[0] ?? "";
  const lastName =
    subject.last_name ??
    subject.full_name.split(" ").slice(1).join(" ") ??
    "";

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={subject.id} />

      <div className={styles.field}>
        <label htmlFor="edit-first-name" className={styles.label}>
          First name
        </label>
        <input
          id="edit-first-name"
          name="first_name"
          defaultValue={firstName}
          required
          className={styles.input}
          disabled={disabled}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="edit-last-name" className={styles.label}>
          Last name
        </label>
        <input
          id="edit-last-name"
          name="last_name"
          defaultValue={lastName}
          required
          className={styles.input}
          disabled={disabled}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="edit-email" className={styles.label}>
          Email
        </label>
        <input
          id="edit-email"
          name="email"
          type="email"
          defaultValue={initialEmail}
          required
          className={styles.input}
          disabled={disabled}
        />
        {readOnly ? null : (
          <p className={styles.fieldHint}>
            Used to sign in. Changing this updates the Supabase auth
            record too.
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="edit-position" className={styles.label}>
          Position
        </label>
        <input
          id="edit-position"
          name="position"
          defaultValue={subject.position ?? ""}
          className={styles.input}
          placeholder="Job title"
          disabled={disabled}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="edit-role" className={styles.label}>
          Role
        </label>
        <select
          id="edit-role"
          name="role"
          defaultValue={subject.role}
          className={styles.select}
          disabled={disabled}
        >
          {roleOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="edit-reports-to" className={styles.label}>
          Reports to
        </label>
        <select
          id="edit-reports-to"
          name="reports_to"
          defaultValue={subject.reports_to ?? ""}
          className={styles.select}
          disabled={disabled}
        >
          <option value="">— No manager on file —</option>
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      {success ? (
        <p role="status" className={styles.successMessage}>
          Saved.
        </p>
      ) : null}

      {readOnly ? null : (
        <div className={styles.submitRow}>
          <button
            type="submit"
            className={uiStyles.btnPrimary}
            disabled={disabled}
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </form>
  );
}
