"use client";

import { useActionState } from "react";
import {
  updateProfileAction,
  type ProfileResult,
} from "@/lib/people/actions";
import styles from "./profile.module.css";

const INITIAL: ProfileResult = { ok: false, message: "" };

// Self-edit: name + position. Role is submitted as the caller's current
// role (server action re-validates it). Self can't change their own role
// per Section 5 — the RLS policy profiles_update_self already enforces this.

export function ProfileDetailsForm({
  id,
  fullName,
  position,
  role,
}: {
  id: string;
  fullName: string;
  position: string;
  role: "system_admin" | "company_admin" | "team_member";
}) {
  const [state, formAction, pending] = useActionState<ProfileResult, FormData>(
    updateProfileAction,
    INITIAL
  );

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const success = state && "ok" in state && state.ok && !pending;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="role" value={role} />

      <div className={styles.field}>
        <label htmlFor="profile-name" className={styles.label}>
          Full name
        </label>
        <input
          id="profile-name"
          name="full_name"
          required
          defaultValue={fullName}
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="profile-position" className={styles.label}>
          Position
        </label>
        <input
          id="profile-position"
          name="position"
          defaultValue={position}
          className={styles.input}
          placeholder="Your job title"
          disabled={pending}
        />
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

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
