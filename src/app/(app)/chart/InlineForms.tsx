"use client";

import { useActionState } from "react";
import {
  createFunctionAction,
  createOutcomeAction,
  createMeasureAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type {
  FunctionNode,
  FunctionOutcome,
  MetricValueType,
  Profile,
  SuccessMeasure,
} from "@/lib/types";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "./chart.module.css";

const INITIAL_FN: ChartResult<FunctionNode> = { ok: false, message: "" };
const INITIAL_OUT: ChartResult<FunctionOutcome> = { ok: false, message: "" };
const INITIAL_MEAS: ChartResult<SuccessMeasure> = { ok: false, message: "" };

// ---- Add Function ----------------------------------------------

export function AddFunctionForm({
  people,
  parentFunctionId,
}: {
  people: Array<Pick<Profile, "id" | "full_name">>;
  parentFunctionId?: string;
}) {
  const [state, formAction, pending] = useActionState<
    ChartResult<FunctionNode>,
    FormData
  >(createFunctionAction, INITIAL_FN);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok),
    { closeAncestor: "details" }
  );

  return (
    <form action={formAction} className={styles.addForm} ref={formRef}>
      {parentFunctionId ? (
        <input type="hidden" name="parent_function_id" value={parentFunctionId} />
      ) : null}

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Function title</span>
        <input
          className={styles.formInput}
          type="text"
          name="title"
          placeholder="e.g. Field Operations"
          required
          disabled={pending}
        />
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Lead</span>
        <select
          className={styles.formSelect}
          name="lead_id"
          defaultValue=""
          disabled={pending}
        >
          <option value="">Unassigned (fill in later)</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Track (optional)</span>
        <select
          className={styles.formSelect}
          name="track_id"
          defaultValue=""
          disabled={pending}
        >
          <option value="">Same as Lead</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Decide (optional)</span>
        <select
          className={styles.formSelect}
          name="decide_id"
          defaultValue=""
          disabled={pending}
        >
          <option value="">Same as Lead</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </label>

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>What this function is on the hook for</span>
        <textarea
          className={styles.formTextarea}
          name="description"
          rows={3}
          placeholder="A short description of the capability this function is responsible for delivering."
          disabled={pending}
        />
      </label>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.formSubmit}>
        <button type="submit" className={uiStyles.btnPrimary} disabled={pending}>
          {pending ? "Adding…" : parentFunctionId ? "Add sub-function" : "Add function"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}

// ---- Add Outcome ----------------------------------------------

export function AddOutcomeForm({ functionId }: { functionId: string }) {
  const [state, formAction, pending] = useActionState<
    ChartResult<FunctionOutcome>,
    FormData
  >(createOutcomeAction, INITIAL_OUT);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok),
    { closeAncestor: "details" }
  );

  return (
    <form action={formAction} className={styles.addForm} ref={formRef}>
      <input type="hidden" name="function_id" value={functionId} />

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Outcome</span>
        <input
          className={styles.formInput}
          type="text"
          name="title"
          placeholder="e.g. Every project ships on schedule"
          required
          disabled={pending}
        />
      </label>

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Why this matters (optional)</span>
        <textarea
          className={styles.formTextarea}
          name="description"
          rows={2}
          placeholder="A sentence about why this outcome earned a spot on the short list."
          disabled={pending}
        />
      </label>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.formSubmit}>
        <button type="submit" className={uiStyles.btnPrimary} disabled={pending}>
          {pending ? "Adding…" : "Add outcome"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}

// ---- Add Measure ----------------------------------------------

export function AddMeasureForm({ outcomeId }: { outcomeId: string }) {
  const [state, formAction, pending] = useActionState<
    ChartResult<SuccessMeasure>,
    FormData
  >(createMeasureAction, INITIAL_MEAS);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok),
    { closeAncestor: "details" }
  );

  const valueTypes: Array<{ value: MetricValueType; label: string }> = [
    { value: "number", label: "Number" },
    { value: "percent", label: "Percent" },
    { value: "text", label: "Text (yes/no)" },
  ];

  return (
    <form action={formAction} className={styles.addForm} ref={formRef}>
      <input type="hidden" name="outcome_id" value={outcomeId} />

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Success measure</span>
        <input
          className={styles.formInput}
          type="text"
          name="description"
          placeholder="e.g. Labor productivity factor on self-perform scopes"
          required
          disabled={pending}
        />
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Target</span>
        <input
          className={styles.formInput}
          type="text"
          name="target"
          placeholder="e.g. 0.95, 90%, Yes"
          disabled={pending}
        />
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Value type</span>
        <select
          className={styles.formSelect}
          name="value_type"
          defaultValue="number"
          disabled={pending}
        >
          {valueTypes.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.formSubmit}>
        <button type="submit" className={uiStyles.btnPrimary} disabled={pending}>
          {pending ? "Adding…" : "Add measure"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}
