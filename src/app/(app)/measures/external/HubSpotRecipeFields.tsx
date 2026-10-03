"use client";

import { useEffect, useState } from "react";
import { hubspotPipelinesAction } from "@/lib/external-measures/actions";
import type { HubSpotPipeline } from "@/lib/external-measures/hubspot-pull";
import styles from "./external.module.css";

// THE HUBSPOT HALF OF THE MAPPING FORM (external connections plan,
// phase 4).
//
// Pipelines and stages come from the company's own HubSpot, through its
// key, so a stage is picked by name and stored by HubSpot's id (which
// survives a rename). The names are stored beside the ids for the
// mapping's description only.
//
//   weekly    add up the amounts, or count the deals, placed in a week
//             by the date created or the date they entered a stage
//   snapshot  one or more parts, added together: the deals in some
//             stages, at full amount or weighted (amount × probability)

export type HubSpotDraft = {
  pipelineId: string;
  measure: "sum_amount" | "count";
  date: "created" | "entered_stage";
  stageId: string;
  parts: Array<{ stageIds: string[]; value: "amount" | "weighted_amount" }>;
};

export const EMPTY_HUBSPOT: HubSpotDraft = {
  pipelineId: "",
  measure: "sum_amount",
  date: "entered_stage",
  stageId: "",
  parts: [{ stageIds: [], value: "amount" }],
};

const MAX_PARTS = 4;

export function HubSpotRecipeFields({
  measureId,
  kind,
  value,
  onChange,
  onPipelines,
}: {
  measureId: string;
  kind: "weekly" | "snapshot";
  value: HubSpotDraft;
  onChange: (next: HubSpotDraft) => void;
  // The pipelines as read, so the parent can store their names.
  onPipelines: (pipelines: HubSpotPipeline[]) => void;
}) {
  const [pipelines, setPipelines] = useState<HubSpotPipeline[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    hubspotPipelinesAction(measureId)
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setPipelines(r.pipelines);
          onPipelines(r.pipelines);
        } else setProblem(r.message);
      })
      .catch(() => live && setProblem("Couldn't read the pipelines from HubSpot. Try again."));
    return () => {
      live = false;
    };
    // Read once per form; the pipelines do not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureId]);

  if (problem) {
    return <p className={`${styles.fieldNote} ${styles.fieldFull}`}>{problem}</p>;
  }
  if (!pipelines) {
    return <p className={`${styles.fieldNote} ${styles.fieldFull}`}>Reading your pipelines from HubSpot…</p>;
  }

  const pipeline = pipelines.find((p) => p.id === value.pipelineId) ?? null;
  const stages = pipeline?.stages ?? [];

  return (
    <>
      <label className={`${styles.field} ${styles.fieldFull}`}>
        <span className={styles.fieldLabel}>Pipeline</span>
        <select
          className={styles.input}
          value={value.pipelineId}
          onChange={(e) =>
            onChange({ ...value, pipelineId: e.target.value, stageId: "", parts: [{ stageIds: [], value: "amount" }] })
          }
        >
          <option value="">Choose a pipeline</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {pipeline && kind === "weekly" ? (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>What to add up</span>
            <select
              className={styles.input}
              value={value.measure}
              onChange={(e) => onChange({ ...value, measure: e.target.value as HubSpotDraft["measure"] })}
            >
              <option value="sum_amount">The deals&rsquo; amounts</option>
              <option value="count">The number of deals</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Which date places a deal in a week</span>
            <select
              className={styles.input}
              value={value.date}
              onChange={(e) => onChange({ ...value, date: e.target.value as HubSpotDraft["date"] })}
            >
              <option value="entered_stage">The date it entered a stage</option>
              <option value="created">The date it was created</option>
            </select>
          </label>
          {value.date === "entered_stage" ? (
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.fieldLabel}>Stage</span>
              <select
                className={styles.input}
                value={value.stageId}
                onChange={(e) => onChange({ ...value, stageId: e.target.value })}
              >
                <option value="">Choose a stage</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className={`${styles.fieldNote} ${styles.fieldFull}`}>
            HubSpot records the date a deal enters a stage itself, so nobody can type it to suit a forecast. That makes it
            the safer choice for &ldquo;won this week&rdquo; than Close date.
          </p>
        </>
      ) : null}

      {pipeline && kind === "snapshot" ? (
        <>
          {value.parts.map((part, i) => (
            <fieldset key={i} className={`${styles.field} ${styles.fieldFull}`}>
              <legend className={styles.fieldLabel}>
                {value.parts.length > 1 ? `Part ${i + 1}: deals in these stages` : "Deals in these stages"}
              </legend>
              {stages.map((s) => (
                <label key={s.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={part.stageIds.includes(s.id)}
                    onChange={(e) => {
                      const stageIds = e.target.checked
                        ? [...part.stageIds, s.id]
                        : part.stageIds.filter((id) => id !== s.id);
                      onChange({ ...value, parts: value.parts.map((p, j) => (j === i ? { ...p, stageIds } : p)) });
                    }}
                  />{" "}
                  {s.label}
                </label>
              ))}
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Counted at</span>
                <select
                  className={styles.input}
                  value={part.value}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      parts: value.parts.map((p, j) =>
                        j === i ? { ...p, value: e.target.value as "amount" | "weighted_amount" } : p
                      ),
                    })
                  }
                >
                  <option value="amount">Full amount</option>
                  <option value="weighted_amount">Weighted amount (amount × probability)</option>
                </select>
              </label>
              {value.parts.length > 1 ? (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onChange({ ...value, parts: value.parts.filter((_, j) => j !== i) })}
                >
                  Remove this part
                </button>
              ) : null}
            </fieldset>
          ))}
          {value.parts.length < MAX_PARTS ? (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => onChange({ ...value, parts: [...value.parts, { stageIds: [], value: "weighted_amount" }] })}
            >
              Add another part
            </button>
          ) : null}
          <p className={`${styles.fieldNote} ${styles.fieldFull}`}>
            Adds up the deals as they stand when the pull runs. A snapshot can&rsquo;t be worked out for past weeks, so it
            starts the week it is first pulled.
          </p>
        </>
      ) : null}
    </>
  );
}
