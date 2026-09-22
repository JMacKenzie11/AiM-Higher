"use client";

import { useActionState, useRef, useState } from "react";
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
import { AddRowButton } from "@/components/ui/AddRowButton";
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
  onCreated,
}: {
  people: Array<Pick<Profile, "id" | "full_name">>;
  // Set when the form is embedded under a specific parent — the
  // picker is hidden and the id is passed as a hidden input.
  parentFunctionId?: string;
  // When omitted, no picker renders (top-level creation only).
  parentOptions?: Array<{ id: string; title: string }>;
  // Fired after the create succeeded and the refresh is on its way.
  // The drawer closes on it. See the note below on why this replaced
  // a redirect.
  onCreated?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ChartResult<FunctionNode>,
    FormData
  >(createFunctionAction, INITIAL_FN);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  // THE WHOLE BOX, IN ONE PANEL.
  //
  // This used to submit three fields and then router.push to the new
  // function's page, because responsibilities need a function_id and
  // there was no function until you had submitted. So naming a
  // function cost you the chart: you left it, typed two lines, and
  // came back to a canvas reset to where it started.
  //
  // The list is client state until submit, goes over as one JSON
  // field, and createFunctionAction writes the rows with the
  // function. Nothing redirects; the drawer closes and the chart
  // behind it refreshes with the finished box on it.
  const [responsibilities, setResponsibilities] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLInputElement>(null);

  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok),
    {
      onSuccess: () => {
        // formRef.reset() clears the inputs the DOM owns. These two
        // are ours, so the next open starts blank rather than on the
        // last function's responsibilities.
        setResponsibilities([]);
        setDraft("");
        onCreated?.();
      },
    }
  );

  function addDraft() {
    const next = draft.trim();
    if (!next) return;
    setResponsibilities((prev) => [...prev, next]);
    setDraft("");
    draftRef.current?.focus();
  }

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

      <div className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Roles &amp; Responsibilities</span>
        {/* The list, as one field. Repeated inputs would have been
            simpler to submit and impossible to reorder or remove
            without a name-index scheme; this is the shape the list
            already has in state. */}
        <input
          type="hidden"
          name="responsibilities"
          value={JSON.stringify(responsibilities)}
        />
        <div className={styles.addRoleList}>
          <div className={`${styles.addRoleRow} ${styles.addRoleRowDefault}`}>
            <span className={styles.addRoleTitle}>Lead, Track, Decide</span>
            <span className={styles.roleBadge}>Baseline</span>
          </div>
          {responsibilities.map((title, i) => (
            <div className={styles.addRoleRow} key={`${title}-${i}`}>
              <span className={styles.addRoleTitle}>{title}</span>
              <button
                type="button"
                className={styles.roleDeleteIcon}
                onClick={() =>
                  setResponsibilities((prev) =>
                    prev.filter((_, at) => at !== i)
                  )
                }
                disabled={pending}
                aria-label={`Remove ${title}`}
                title="Remove"
              >
                <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
                  <path
                    d="M4 5 h8 v8 a1 1 0 0 1 -1 1 h-6 a1 1 0 0 1 -1 -1 z M6.5 5 V3.5 a1 1 0 0 1 1 -1 h1 a1 1 0 0 1 1 1 V5 M3 5 h10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          ))}
          <div className={`${styles.addRoleRow} ${styles.addRoleRowDraft}`}>
            <input
              ref={draftRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              // Enter adds a row; it does NOT submit the form. A
              // half-typed responsibility followed by Enter creating
              // the function is the shape of a box you then have to
              // go and fix.
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft("");
                }
              }}
              className={styles.roleInput}
              placeholder="Add a responsibility"
              disabled={pending}
              aria-label="New responsibility"
            />
            <AddRowButton pending={pending} onClick={addDraft} type="button" />
          </div>
        </div>
      </div>

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
            formRef.current?.reset();
            setResponsibilities([]);
            setDraft("");
            onCreated?.();
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
    { value: "currency", label: "Currency ($)" },
    { value: "percent", label: "Percent" },
    { value: "text", label: "Yes/No" },
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
          Include this measure in the Tuesday check that creates a
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
