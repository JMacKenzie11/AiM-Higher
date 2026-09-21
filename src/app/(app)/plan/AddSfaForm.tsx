"use client";

import { useActionState, useId } from "react";
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
  onAdded,
}: {
  people: Pick<Profile, "id" | "full_name">[];
  // Called after a successful create, once router.refresh()
  // has been requested. The plan toolbar's Drawer closes on it.
  onAdded?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    PlanResult<StrategicFocusArea>,
    FormData
  >(createSfaAction, INITIAL);

  // Field ids are SCOPED PER FORM INSTANCE. These forms render many
  // times on /plan — once in the toolbar, once inside every focus
  // area, once under every goal — and a fixed id would put several
  // elements with the same id in one document. That is invalid HTML,
  // and it breaks the thing the id is for: <label htmlFor> resolves
  // to the FIRST match, so clicking a field's own label focuses a
  // different form's field. `useId` gives each instance its own.
  const uid = useId();
  const fieldId = (name: string) => `${name}-${uid}`;
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok),
    { closeAncestor: "details", onSuccess: onAdded }
  );

  return (
    <form action={formAction} className={styles.form} ref={formRef}>
      <div className={styles.field}>
        <label htmlFor={fieldId("sfa-title")} className={styles.label}>
          Title
        </label>
        <input
          id={fieldId("sfa-title")}
          name="title"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId("sfa-sponsor")} className={styles.label}>
          Sponsor
        </label>
        <select
          id={fieldId("sfa-sponsor")}
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
        <label htmlFor={fieldId("sfa-description")} className={styles.label}>
          Future-perfect narrative
        </label>
        <textarea
          id={fieldId("sfa-description")}
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
          {pending ? "Adding…" : "Add Focus Area"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}
