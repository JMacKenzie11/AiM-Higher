"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  parentOptions,
}: {
  people: Array<Pick<Profile, "id" | "full_name">>;
  // Set when the form is embedded under a specific parent — the
  // picker is hidden and the id is passed as a hidden input.
  parentFunctionId?: string;
  // When omitted, no picker renders (top-level creation only).
  parentOptions?: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
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

  // Straight to the detail page after save — that's where R&R and
  // Success Measures get filled in inline. useStayOpenForm above
  // resets the fields and closes the disclosure, so the redirect is
  // additive: momentum lands on the new function.
  useEffect(() => {
    if (state && "ok" in state && state.ok && state.item?.id) {
      router.push(`/chart/function/${state.item.id}`);
    }
  }, [state, router]);

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

      {parentOptions && parentOptions.length > 0 ? (
        <label className={styles.formField}>
          <span className={styles.formLabel}>Sub-function of (optional)</span>
          <select
            className={styles.formSelect}
            name="parent_function_id"
            defaultValue=""
            disabled={pending}
          >
            <option value="">Top level (no parent)</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className={styles.formField}>
        <span className={styles.formLabel}>Who&rsquo;s in the seat</span>
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

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.formSubmit}>
        <button type="submit" className={uiStyles.btnPrimary} disabled={pending}>
          {pending ? "Adding…" : parentFunctionId ? "Add sub-function" : "Add function"}
        </button>
        <button
          type="button"
          className={uiStyles.btnGhost}
          disabled={pending}
          onClick={() => {
            const details = formRef.current?.closest("details");
            if (details instanceof HTMLDetailsElement) details.open = false;
            formRef.current?.reset();
          }}
        >
          Cancel
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
          placeholder="A sentence about why this earned a spot on the short list."
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

export function AddMeasureForm({
  outcomeId,
  requireTarget = false,
}: {
  outcomeId: string;
  // When the company has performance_tracking on, target becomes
  // mandatory at the client + server layer. Direction + auto-track
  // controls surface unconditionally so the metadata is available
  // whether or not the flag is on today.
  requireTarget?: boolean;
}) {
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
        <span className={styles.formLabel}>Metric</span>
        <input
          className={styles.formInput}
          type="text"
          name="description"
          placeholder="e.g. % of projects shipped on time"
          required
          disabled={pending}
        />
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>
          Target{requireTarget ? " *" : ""}
        </span>
        <input
          className={styles.formInput}
          type="text"
          name="target"
          placeholder="e.g. 0.95, 90%, Yes"
          disabled={pending}
          required={requireTarget}
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

      <label className={styles.formField}>
        <span className={styles.formLabel}>Direction</span>
        <select
          className={styles.formSelect}
          name="target_direction"
          defaultValue="higher_is_better"
          disabled={pending}
        >
          <option value="higher_is_better">Higher is better</option>
          <option value="lower_is_better">Lower is better</option>
        </select>
      </label>

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>
          <input
            type="checkbox"
            name="auto_track"
            defaultChecked
            disabled={pending}
            style={{ marginRight: "8px" }}
          />
          Auto-track weekly updates
        </span>
        <span
          style={{
            fontSize: "12px",
            color: "var(--text-muted)",
            marginTop: "2px",
          }}
        >
          Include this measure in the Saturday check that creates a
          commitment when the week&rsquo;s value wasn&rsquo;t logged.
          Turn off for context measures like headcount.
        </span>
      </label>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.formSubmit}>
        <button type="submit" className={uiStyles.btnPrimary} disabled={pending}>
          {pending ? "Adding…" : "Add metric"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}
