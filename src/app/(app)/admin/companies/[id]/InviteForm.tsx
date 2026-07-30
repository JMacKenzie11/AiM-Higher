"use client";

import { useActionState, useState } from "react";
import { createUserAction, type UserActionResult } from "@/lib/auth/users";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "../admin.module.css";

// Add a user to a company. The person can be created without sending
// the invite email — admins can pre-stage the roster, assign work,
// then send the invite when they're ready. Strengths + superpowers
// entered here feed the coaching context immediately (no assessment).

const INITIAL: UserActionResult = { ok: false, message: "" };

export function InviteForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState<
    UserActionResult,
    FormData
  >(createUserAction, INITIAL);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok)
  );

  const [strengths, setStrengths] = useState<string[]>([""]);
  const [superpowers, setSuperpowers] = useState<string[]>([""]);

  function updateAt(list: string[], idx: number, value: string) {
    const next = list.slice();
    next[idx] = value;
    return next;
  }

  return (
    <form action={formAction} className={styles.form} ref={formRef}>
      <input type="hidden" name="company_id" value={companyId} />

      <div className={styles.field}>
        <label htmlFor="user-name" className={styles.label}>
          Full name
        </label>
        <input
          id="user-name"
          name="full_name"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="user-email" className={styles.label}>
          Email
        </label>
        <input
          id="user-email"
          name="email"
          type="email"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="user-position" className={styles.label}>
          Position
        </label>
        <input
          id="user-position"
          name="position"
          className={styles.input}
          placeholder="Job title (optional)"
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="user-role" className={styles.label}>
          Role
        </label>
        <select
          id="user-role"
          name="role"
          defaultValue="team_member"
          className={styles.select}
          disabled={pending}
        >
          <option value="team_member">Member</option>
          <option value="company_admin">Company Admin</option>
        </select>
      </div>

      <fieldset className={`${styles.field} ${styles.formFull}`}>
        <legend className={styles.label}>Strengths</legend>
        {strengths.map((value, idx) => (
          <input
            key={`s-${idx}`}
            name="strength_label"
            value={value}
            onChange={(e) => setStrengths((prev) => updateAt(prev, idx, e.target.value))}
            className={styles.input}
            placeholder="e.g. Strategic thinking"
            disabled={pending}
            maxLength={120}
          />
        ))}
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => setStrengths((prev) => [...prev, ""])}
          disabled={pending}
        >
          + Add another strength
        </button>
      </fieldset>

      <fieldset className={`${styles.field} ${styles.formFull}`}>
        <legend className={styles.label}>Superpowers</legend>
        {superpowers.map((value, idx) => (
          <input
            key={`p-${idx}`}
            name="superpower_label"
            value={value}
            onChange={(e) => setSuperpowers((prev) => updateAt(prev, idx, e.target.value))}
            className={styles.input}
            placeholder="e.g. Reading a room"
            disabled={pending}
            maxLength={120}
          />
        ))}
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => setSuperpowers((prev) => [...prev, ""])}
          disabled={pending}
        >
          + Add another superpower
        </button>
      </fieldset>

      <label className={`${styles.checkOption} ${styles.formFull}`}>
        <input type="checkbox" name="send_invite_now" disabled={pending} />
        Send invite email now
      </label>

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
          {pending ? "Adding…" : "Add user"}
        </button>
        <ConfirmationChip visible={confirmationVisible} label="User added" />
      </div>
    </form>
  );
}
