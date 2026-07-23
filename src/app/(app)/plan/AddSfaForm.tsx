"use client";

import { useActionState } from "react";
import {
  createSfaAction,
  type PlanResult,
} from "@/lib/plan/actions";
import type { Profile, StrategicFocusArea } from "@/lib/types";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "./plan.module.css";

const INITIAL: PlanResult<StrategicFocusArea> = { ok: false, message: "" };

export function AddSfaForm({
  people,
}: {
  people: Pick<Profile, "id" | "full_name">[];
}) {
  const [state, formAction, pending] = useActionState<
    PlanResult<StrategicFocusArea>,
    FormData
  >(createSfaAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok),
    { closeAncestor: "details" }
  );

  return (
    <form action={formAction} className={styles.form} ref={formRef}>
      <div className={styles.field}>
        <label htmlFor="sfa-title" className={styles.label}>
          Title
        </label>
        <input
          id="sfa-title"
          name="title"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="sfa-sponsor" className={styles.label}>
          Sponsor
        </label>
        <select
          id="sfa-sponsor"
          name="sponsor_id"
          className={styles.select}
          disabled={pending}
          defaultValue=""
        >
          <option value="">No sponsor yet</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.fieldWide}>
        <label htmlFor="sfa-description" className={styles.label}>
          Future-perfect narrative
        </label>
        <textarea
          id="sfa-description"
          name="description"
          className={styles.textarea}
          disabled={pending}
          rows={3}
          placeholder="In three years, what does great look like?"
        />
      </div>

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
          {pending ? "Adding…" : "Add Strategic Focus Area"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}
