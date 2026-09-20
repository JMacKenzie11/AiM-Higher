"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  archiveMeasureAction,
  createOutcomeAction,
  updateMeasureAction,
  type ChartResult,
} from "@/lib/chart/actions";
import { critiqueMeasureDraftAction } from "@/lib/measures/actions";
import { ruleBasedCritique } from "@/lib/measures/critique-rules";
import { shouldCritiqueOnBlur } from "@/lib/measures/critique-blur";
import type { MeasureCritique } from "@/lib/measures/critique-rules";
import type { MetricValueType, SuccessMeasure, TargetDirection } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "./measures.module.css";
import chartStyles from "../chart/chart.module.css";
import {
  MEASURE_SCALES,
  parseScale,
  parseTypedNumber,
  scaleApplies,
  toEntryNumber,
  type MeasureScale,
} from "@/lib/measures/value-format";

// The measure settings form, and the archive control beside it.
//
// Lifted out of ManagedMeasureRow so the grid can open it in an
// expanded row without pulling in the row rendering it no longer
// uses. One form, two callers, so a field cannot appear in one place
// and not the other.
//
// `measure` is deliberately structural rather than the tree's row
// type: this form reads six fields and nothing else, and typing it to
// the shape of whatever page is calling is what made it hard to move.

const INITIAL: ChartResult<SuccessMeasure> = { ok: false, message: "" };

const VALUE_TYPES: Array<{ value: MetricValueType; label: string }> = [
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency ($)" },
  { value: "percent", label: "Percent" },
  { value: "text", label: "Yes/No" },
];

export type EditableMeasure = {
  id: string;
  description: string;
  value_scale?: string | null;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  update_frequency: string;
  auto_track: boolean;
  show_on_dashboard: boolean;
};

// ONE FORM FOR ADD AND EDIT.
//
// Adding used to be two steps: type a name in a row under the table,
// then find the row and open its settings to say what good looks
// like. That made sense when a critical success factor was a heading
// and the measurable thing lived underneath it. With one level there
// is nothing to separate, and a row created without a target is a row
// somebody has to come back to.
//
// `createIn` is the difference. Present, the form posts to
// createOutcomeAction against that function and shows a functional
// area picker; absent, it updates the measure it was given.
export function EditMeasureForm({
  measure,
  outcomeTitle,
  outcomeDescription,
  onDone,
  onCreated,
  createIn,
  functionChoices,
  onFunctionChange,
}: {
  measure: EditableMeasure;
  outcomeTitle: string;
  outcomeDescription: string | null;
  onDone: () => void;
  // Called with the new measure's id after a create. The drawer uses
  // it to stay open on the row that was just made, so the external
  // source fields become live without a second trip.
  onCreated?: (id: string) => void;
  // The function a new measure belongs to. Absent means edit.
  createIn?: string;
  // Offered in create mode so the area is chosen in the same panel
  // rather than before it opens.
  functionChoices?: ReadonlyArray<{ id: string; title: string }>;
  onFunctionChange?: (id: string) => void;
}) {
  const creating = createIn !== undefined;
  const [state, formAction, pending] = useActionState<
    ChartResult<SuccessMeasure>,
    FormData
  >(
    (creating
      ? createOutcomeAction
      : updateMeasureAction) as unknown as (
      prev: ChartResult<SuccessMeasure> | undefined,
      fd: FormData
    ) => Promise<ChartResult<SuccessMeasure>>,
    INITIAL
  );
  const [description, setDescription] = useState(measure.description);
  // THE TARGET BOX IS TYPED IN THE MEASURE'S UNIT, and the stored
  // target is the true number — so an existing one comes back down
  // to the unit before it is shown, exactly as a value does. Without
  // this, editing a millions measure would show 18000000 in a box
  // that expects 18, and saving would multiply it again.
  const initialScale = parseScale(measure.value_scale);
  const [target, setTarget] = useState(() => {
    const raw = measure.target ?? "";
    if (!raw || !scaleApplies(measure.value_type) || initialScale === "plain") {
      return raw;
    }
    const n = parseTypedNumber(raw);
    return n === null
      ? raw
      : String(toEntryNumber(n, measure.value_type, initialScale));
  });
  const [valueType, setValueType] = useState<MetricValueType>(
    measure.value_type
  );
  // Storage is always the true number; this decides what the entry
  // box shows and what the page renders. See measures/value-format.
  const [scale, setScale] = useState<MeasureScale>(initialScale);
  const [direction, setDirection] = useState<TargetDirection>(
    measure.target_direction
  );
  const [aiCritique, setAiCritique] = useState<MeasureCritique | null>(null);
  const [critiqueLoading, setCritiqueLoading] = useState(false);
  const lastCritiquedKey = useRef<string | null>(null);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  const ruleHints = useMemo(
    () => ruleBasedCritique({ description, target, valueType }),
    [description, target, valueType]
  );
  const fitBad = !!aiCritique?.fitHint;
  const shownHints = {
    descriptionHint: fitBad
      ? null
      : aiCritique?.descriptionHint ?? ruleHints.descriptionHint,
    targetHint: fitBad ? null : aiCritique?.targetHint ?? ruleHints.targetHint,
    fitHint: aiCritique?.fitHint ?? null,
  };

  useEffect(() => {
    if (!state || !("ok" in state) || !state.ok) return;
    // A CREATE HANDS BACK ITS ROW rather than closing. Connecting a
    // spreadsheet needs a measure to attach to, and there is no id
    // until this moment: closing here would mean adding the measure,
    // finding it in the table and opening it again to do the half of
    // the job the panel was already showing.
    const created = creating ? (state.item as { id?: string })?.id : null;
    if (created && onCreated) onCreated(created);
    else onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    const key = `${valueType}|${direction}|${description.trim()}|${target.trim()}`;
    if (lastCritiquedKey.current && lastCritiquedKey.current !== key) {
      setAiCritique(null);
    }
  }, [description, target, valueType, direction]);

  // The event is read, not ignored: a blur caused by reaching for
  // Save or Cancel must not re-render the form, because the critique
  // panel sits above the buttons and moving them mid-click eats the
  // click. See shouldCritiqueOnBlur.
  async function runAiCritique(
    event?: Pick<React.FocusEvent<HTMLElement>, "relatedTarget">
  ) {
    if (event && !shouldCritiqueOnBlur(event)) return;
    const d = description.trim();
    if (d.length < 4) return;
    const key = `${valueType}|${direction}|${d}|${target.trim()}`;
    if (lastCritiquedKey.current === key) return;
    lastCritiquedKey.current = key;
    setCritiqueLoading(true);
    try {
      const result = await critiqueMeasureDraftAction({
        description: d,
        target: target.trim(),
        valueType,
        direction,
        outcomeTitle,
        outcomeDescription,
      });
      setAiCritique(result);
    } finally {
      setCritiqueLoading(false);
    }
  }

  const hasAnyHint =
    !!shownHints.descriptionHint ||
    !!shownHints.targetHint ||
    !!shownHints.fitHint;

  return (
    <form action={formAction} className={chartStyles.addForm}>
      {creating ? (
        <>
          <input type="hidden" name="function_id" value={createIn} />
          {/* The action reads `title` on create and `description` on
              update. One input, named for whichever it is, so the
              field below stays a single controlled value. */}
          <input type="hidden" name="title" value={description} />
        </>
      ) : (
        <input type="hidden" name="id" value={measure.id} />
      )}
      {/* Tells the action that this payload carries the checkbox at
          all, so an unchecked box reads as off rather than as a
          caller that never sent one. */}
      <input type="hidden" name="auto_track_present" value="1" />

      {creating && functionChoices && functionChoices.length > 1 ? (
        <label className={chartStyles.formField}>
          <span className={chartStyles.formLabel}>Functional area</span>
          <select
            className={chartStyles.formInput}
            value={createIn}
            onChange={(e) => onFunctionChange?.(e.target.value)}
            disabled={pending}
          >
            {functionChoices.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label
        className={`${chartStyles.formField} ${chartStyles.formFieldFull}`}
      >
        <span className={chartStyles.formLabel}>
          Critical success factor
        </span>
        <input
          className={chartStyles.formInput}
          type="text"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={(e) => runAiCritique(e)}
          required
          disabled={pending}
          autoFocus
        />
      </label>

      <label className={chartStyles.formField}>
        <span className={chartStyles.formLabel}>Target</span>
        <input
          className={chartStyles.formInput}
          type="text"
          name="target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={(e) => runAiCritique(e)}
          placeholder="e.g. 0.95, 90%, Yes"
          disabled={pending}
        />
      </label>

      <label className={chartStyles.formField}>
        <span className={chartStyles.formLabel}>Value type</span>
        <select
          className={chartStyles.formSelect}
          name="value_type"
          value={valueType}
          onChange={(e) => setValueType(e.target.value as MetricValueType)}
          disabled={pending}
        >
          {VALUE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {/* HIDDEN FOR A YES/NO MEASURE, not disabled.
 
          "Higher is better" is not a question you can answer about
          Yes, and a greyed-out control still takes up a row and still
          invites "why can't I use this?". Hiding it says the question
          does not apply.
 
          The value is still SUBMITTED, because target_direction is
          not null in the database and because flipping the type back
          to Number should find the direction where it was left. */}
      {valueType === "text" ? (
        <input type="hidden" name="target_direction" value={direction} />
      ) : (
        <label className={chartStyles.formField}>
          <span className={chartStyles.formLabel}>Direction</span>
          <select
            className={chartStyles.formSelect}
            name="target_direction"
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value as TargetDirection)
            }
            disabled={pending}
          >
            <option value="higher_is_better">Higher is better</option>
            <option value="lower_is_better">Lower is better</option>
          </select>
        </label>
      )}

      {/* UNITS, and only where a unit means anything. A percent in
          millions is not a thing and text has no magnitude. */}
      {scaleApplies(valueType) ? (
        <label className={chartStyles.formField}>
          <span className={chartStyles.formLabel}>Units</span>
          <select
            className={chartStyles.formSelect}
            name="value_scale"
            value={scale}
            onChange={(e) => setScale(parseScale(e.target.value))}
            disabled={pending}
          >
            {MEASURE_SCALES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="value_scale" value={scale} />
      )}

      <label className={chartStyles.formField}>
        <span className={chartStyles.formLabel}>How often to update</span>
        <select
          name="update_frequency"
          defaultValue={measure.update_frequency ?? "weekly"}
          disabled={pending}
          className={chartStyles.formInput}
        >
          <option value="weekly">Every week</option>
          <option value="biweekly">Every two weeks</option>
          <option value="monthly">Every month</option>
        </select>
      </label>

      <label
        className={`${chartStyles.formField} ${chartStyles.formFieldFull}`}
      >
        <span className={chartStyles.formLabel}>
          <input
            type="checkbox"
            name="auto_track"
            defaultChecked={measure.auto_track}
            disabled={pending}
            style={{ marginRight: "8px" }}
          />
          {/* Was "Auto-track weekly updates", which said what the
              system does rather than what happens to the person
              reading it, and hard-coded weekly now that frequency
              is a choice. */}
          Remind the owner when this is due
        </span>
      </label>

      <label
        className={`${chartStyles.formField} ${chartStyles.formFieldFull}`}
      >
        <span className={chartStyles.formLabel}>
          <input
            type="checkbox"
            name="show_on_dashboard"
            defaultChecked={measure.show_on_dashboard}
            disabled={pending}
            style={{ marginRight: "8px" }}
          />
          Show on company dashboard
        </span>
      </label>

      {errorMessage ? (
        <p role="alert" className={chartStyles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      {/* THE BUTTONS SIT ABOVE THE CRITIQUE, and that ordering is
          the fix for a bug with a long tail.

          The panel used to be above this row. It grows when the
          critique arrives, which moves the buttons between mousedown
          and mouseup, and the click never lands: Save and Cancel both
          needed pressing twice. `shouldCritiqueOnBlur` was written to
          dodge it by skipping the critique when focus moves to a
          button, and it cannot always tell: a browser that does not
          focus a button on mousedown reports a null relatedTarget,
          which is indistinguishable from an ordinary blur.

          critique-blur.ts named this fix when it was written: "the
          durable fix is for the critique panel to not occupy layout
          above the action row". Nothing above these buttons changes
          size now, so nothing can move them.

          The hints read second, which is right for advisory text. */}
      <div className={`${chartStyles.formSubmit} ${styles.formFooter}`}>
        <button
          type="submit"
          className={uiStyles.btnPrimary}
          disabled={pending}
        >
          {pending ? "Saving…" : creating ? "Add" : "Save"}
        </button>
        {/* Bordered, like Save beside it. btnGhost drops the border
            so a text action does not float away from what it acts on,
            which is right in a table row and wrong in a footer where
            it sits next to an outlined button and reads as unfinished
            next to it. */}
        <button
          type="button"
          className={uiStyles.btnSecondary}
          disabled={pending}
          onClick={onDone}
        >
          Cancel
        </button>
      </div>

      {(hasAnyHint || critiqueLoading) &&
      description.trim().length > 0 ? (
        <div
          className={`${chartStyles.critiquePanel} ${chartStyles.formFieldFull}`}
        >
          {shownHints.descriptionHint ? (
            <p className={chartStyles.critiqueLine}>
              <span className={chartStyles.critiqueLabel}>
                Factor
              </span>{" "}
              {shownHints.descriptionHint}
            </p>
          ) : null}
          {shownHints.targetHint ? (
            <p className={chartStyles.critiqueLine}>
              <span className={chartStyles.critiqueLabel}>Target</span>{" "}
              {shownHints.targetHint}
            </p>
          ) : null}
          {shownHints.fitHint ? (
            <p className={chartStyles.critiqueLine}>
              <span className={chartStyles.critiqueLabel}>Fit</span>{" "}
              {shownHints.fitHint}
            </p>
          ) : null}
          {critiqueLoading ? (
            <p className={chartStyles.critiqueLoading}>Reviewing…</p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export function ArchiveMeasureButton({ measureId }: { measureId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function run() {
    setConfirming(false);
    startTransition(async () => {
      const result = await archiveMeasureAction(measureId, true);
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.iconDeleteButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Archive this KPI"
        title="Archive this KPI"
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
      <ConfirmDialog
        open={confirming}
        title="Archive this KPI?"
        message="Historical weekly entries are kept. The KPI disappears from its critical success factor and stops feeding the weekly check."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {message ? (
        <span role="alert" className={styles.rowError}>
          {message}
        </span>
      ) : null}
    </>
  );
}
