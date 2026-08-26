"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  createMeasureAction,
  type ChartResult,
} from "@/lib/chart/actions";
import { critiqueMeasureDraftAction } from "@/lib/measures/actions";
import { ruleBasedCritique } from "@/lib/measures/critique-rules";
import type { MeasureCritique } from "@/lib/measures/critique-rules";
import type { MetricValueType, SuccessMeasure } from "@/lib/types";
import { SuggestOptionsPopover } from "./SuggestOptionsPopover";
import styles from "../../chart.module.css";

// Always-live "add a metric" row matched to the roles list rhythm.
// Three visible fields — description, target, value type — then Add
// (or press Enter). Direction defaults to higher_is_better and
// auto_track stays on; both are editable per-metric via the row's
// Edit affordance after creation so the sub-form doesn't need to
// nag every new-metric user.
//
// Live coaching: rule-based hints render as the user types (weak
// phrases, missing digits, "quality" / "improve" / "do your best"
// etc.). On blur of description or target, an AI critique fires
// once with the same fields plus the parent Success Measure's
// title/context — the AI hint covers description quality, target
// clarity, AND fit-to-outcome, and replaces the rule hint on that
// dimension when it returns. Flag-not-block: Add stays enabled
// throughout.

const INITIAL: ChartResult<SuccessMeasure> = { ok: false, message: "" };

const VALUE_TYPES: Array<{ value: MetricValueType; label: string }> = [
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "text", label: "Yes / No" },
];

export function AddMetricRow({
  outcomeId,
  outcomeTitle,
  outcomeDescription,
  functionId,
  rdEnabled,
  trackingEnabled = true,
  onAdded,
}: {
  outcomeId: string;
  outcomeTitle: string;
  outcomeDescription: string | null;
  functionId: string;
  rdEnabled: boolean;
  // When the company doesn't have Success Tracking on, hide the
  // target input + AI critique — target is meaningless without a
  // weekly log to compare against, and the AI would only nag about
  // the target. Defaults to true so any legacy caller behaves as
  // before.
  trackingEnabled?: boolean;
  // Called after a successful save. Parents that want a "click to
  // open, close after add" pattern pass this to collapse the form;
  // when omitted the row keeps its rapid-fire behaviour (reset
  // fields, refocus the description input).
  onAdded?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ChartResult<SuccessMeasure>,
    FormData
  >(createMeasureAction, INITIAL);
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [valueType, setValueType] = useState<MetricValueType>("number");
  const [aiCritique, setAiCritique] = useState<MeasureCritique | null>(null);
  const [critiqueLoading, setCritiqueLoading] = useState(false);
  const lastCritiquedKey = useRef<string | null>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  const ruleHints = useMemo(
    () => ruleBasedCritique({ description, target, valueType }),
    [description, target, valueType]
  );

  // AI takes precedence on any dimension it reported on; the rule
  // layer covers the rest. Both null on that dimension = no hint.
  //
  // Precedence rule: when the AI flags a fit problem, hide the
  // metric- and target-quality hints. Polishing the wording of a
  // metric that measures the wrong thing pulls attention from the
  // real fix — rethink what to count. The prompt asks the model to
  // null those out itself; this is a belt-and-suspenders filter.
  const fitBad = !!aiCritique?.fitHint;
  const shownHints = {
    descriptionHint: fitBad
      ? null
      : aiCritique?.descriptionHint ?? ruleHints.descriptionHint,
    targetHint: fitBad
      ? null
      : aiCritique?.targetHint ?? ruleHints.targetHint,
    fitHint: aiCritique?.fitHint ?? null,
  };

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      setDescription("");
      setTarget("");
      setValueType("number");
      setAiCritique(null);
      lastCritiquedKey.current = null;
      if (onAdded) {
        onAdded();
      } else {
        descriptionRef.current?.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function runAiCritique() {
    // Target critique is meaningless without a weekly log to
    // compare against — skip the AI call when tracking is off so
    // we don't burn tokens or leave a stale target_hint on the row.
    if (!trackingEnabled) return;
    const d = description.trim();
    if (d.length < 4) return; // too short to critique usefully
    const key = `${valueType}|${d}|${target.trim()}`;
    if (lastCritiquedKey.current === key) return;
    lastCritiquedKey.current = key;
    setCritiqueLoading(true);
    try {
      const result = await critiqueMeasureDraftAction({
        description: d,
        target: target.trim(),
        valueType,
        direction: "higher_is_better",
        outcomeTitle,
        outcomeDescription,
      });
      setAiCritique(result);
    } finally {
      setCritiqueLoading(false);
    }
  }

  // Reset the AI critique whenever the fields drift away from the
  // last critiqued version — otherwise a stale hint sits under a
  // description the user has since fixed.
  useEffect(() => {
    const key = `${valueType}|${description.trim()}|${target.trim()}`;
    if (lastCritiquedKey.current && lastCritiquedKey.current !== key) {
      setAiCritique(null);
    }
  }, [description, target, valueType]);

  const hasAnyHint =
    !!shownHints.descriptionHint ||
    !!shownHints.targetHint ||
    !!shownHints.fitHint;

  return (
    <div className={styles.addMetricGroup}>
      <p className={styles.addMetricAnchor}>
        Should drive progress on:{" "}
        <span className={styles.addMetricAnchorTitle}>{outcomeTitle}</span>
      </p>
      <form action={formAction} className={styles.addMetricRow}>
        <input type="hidden" name="outcome_id" value={outcomeId} />
        <input type="hidden" name="target_direction" value="higher_is_better" />
        <input type="hidden" name="auto_track" value="on" />

        <input
          ref={descriptionRef}
          type="text"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={runAiCritique}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setDescription("");
              setTarget("");
              setAiCritique(null);
              lastCritiquedKey.current = null;
            }
          }}
          className={styles.addMetricInput}
          placeholder="Add a metric — e.g. % of projects on time"
          required
          disabled={pending}
          aria-label="New metric"
        />

        {trackingEnabled ? (
          <input
            type="text"
            name="target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={runAiCritique}
            className={styles.addMetricTarget}
            placeholder={
              valueType === "percent"
                ? "e.g. 90%"
                : valueType === "text"
                  ? "e.g. Yes"
                  : "e.g. 0.95"
            }
            disabled={pending}
            aria-label="Target"
          />
        ) : null}

        <select
          name="value_type"
          value={valueType}
          onChange={(e) => setValueType(e.target.value as MetricValueType)}
          className={styles.addMetricType}
          disabled={pending}
          aria-label="Value type"
        >
          {VALUE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        {/* Enter submits the form from any field — no visible Add
            button, consistent with the other draft rows on this
            page (R&R, Decision Rights, Competencies). */}
        {pending ? (
          <span className={styles.roleSavingHint}>Saving…</span>
        ) : null}

        {errorMessage ? (
          <p role="alert" className={styles.roleError}>
            {errorMessage}
          </p>
        ) : null}
      </form>

      {trackingEnabled &&
      (hasAnyHint || critiqueLoading) &&
      description.trim().length > 0 ? (
        <CritiquePanel hints={shownHints} loading={critiqueLoading} />
      ) : null}

      {rdEnabled ? (
        <SuggestOptionsPopover
          functionId={functionId}
          target="measures"
          outcomeId={outcomeId}
          buttonLabel="Suggest metrics"
          onSave={async (t, _body, extras) => {
            // The suggestion prompt returns a first-class `target`
            // field for measures (required when the company has
            // performance_tracking on, else createMeasureAction
            // rejects with "every measure needs a target"). Value
            // type is auto-detected from the target's shape so we
            // don't need the model to emit it — % → percent,
            // yes/no → text, everything else → number. Direction
            // and auto_track stay at safe defaults; user can tune
            // both per-metric from the inline Edit form after
            // creation.
            const targetValue = extras?.target?.trim() ?? "";
            const valueType = guessValueType(targetValue);
            const fd = new FormData();
            fd.set("outcome_id", outcomeId);
            fd.set("description", t);
            fd.set("value_type", valueType);
            fd.set("target_direction", "higher_is_better");
            fd.set("auto_track", "on");
            if (targetValue) fd.set("target", targetValue);
            const r = await createMeasureAction(undefined, fd);
            return r.ok ? { ok: true } : { ok: false, message: r.message };
          }}
        />
      ) : null}
    </div>
  );
}

function guessValueType(target: string): MetricValueType {
  const t = target.trim().toLowerCase();
  if (t.includes("%")) return "percent";
  if (t === "yes" || t === "no" || t === "y" || t === "n") return "text";
  return "number";
}

function CritiquePanel({
  hints,
  loading,
}: {
  hints: {
    descriptionHint: string | null;
    targetHint: string | null;
    fitHint: string | null;
  };
  loading: boolean;
}) {
  return (
    <div className={styles.critiquePanel}>
      {hints.descriptionHint ? (
        <p className={styles.critiqueLine}>
          <span className={styles.critiqueLabel}>Metric</span>{" "}
          {hints.descriptionHint}
        </p>
      ) : null}
      {hints.targetHint ? (
        <p className={styles.critiqueLine}>
          <span className={styles.critiqueLabel}>Target</span>{" "}
          {hints.targetHint}
        </p>
      ) : null}
      {hints.fitHint ? (
        <p className={styles.critiqueLine}>
          <span className={styles.critiqueLabel}>Fit</span> {hints.fitHint}
        </p>
      ) : null}
      {loading ? (
        <p className={styles.critiqueLoading}>Reviewing…</p>
      ) : null}
    </div>
  );
}
