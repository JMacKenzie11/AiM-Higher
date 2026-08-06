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
}: {
  outcomeId: string;
  outcomeTitle: string;
  outcomeDescription: string | null;
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
  const shownHints = {
    descriptionHint: aiCritique?.descriptionHint ?? ruleHints.descriptionHint,
    targetHint: aiCritique?.targetHint ?? ruleHints.targetHint,
    fitHint: aiCritique?.fitHint ?? null,
  };

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      setDescription("");
      setTarget("");
      setValueType("number");
      setAiCritique(null);
      lastCritiquedKey.current = null;
      descriptionRef.current?.focus();
    }
  }, [state]);

  async function runAiCritique() {
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

        <button
          type="submit"
          className={styles.rolePrimaryButton}
          disabled={pending || !description.trim()}
        >
          {pending ? "Adding…" : "Add"}
        </button>

        {errorMessage ? (
          <p role="alert" className={styles.roleError}>
            {errorMessage}
          </p>
        ) : null}
      </form>

      {(hasAnyHint || critiqueLoading) && description.trim().length > 0 ? (
        <CritiquePanel
          hints={shownHints}
          loading={critiqueLoading}
        />
      ) : null}
    </div>
  );
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
