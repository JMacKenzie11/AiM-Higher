"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  generateNarrativeAction,
  publishReadoutAction,
  recordDecisionAction,
  saveNarrativeSectionAction,
  saveRoadmapAction,
} from "@/lib/diagnostics/actions";
import { READOUT_SECTIONS, type Decision, type Narrative, type ReadoutSection, type RoadmapItem } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// The Readout step's controls: the roadmap, the narrative, Publish and
// the decision. Everything but the decision stops once published.

export function RoadmapEditor({ diagnosticId, items, locked }: { diagnosticId: string; items: RoadmapItem[]; locked: boolean }) {
  const blank = (): RoadmapItem => ({ title: "", target_week: null, champion: "" });
  const [rows, setRows] = useState<RoadmapItem[]>([0, 1, 2].map((i) => items[i] ?? blank()));
  const { pending, error, saved, run } = useDxAction();
  const set = (i: number, patch: Partial<RoadmapItem>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className={styles.body}>
      {rows.map((row, i) => (
        <div key={i} className={styles.roadmapRow}>
          <div className={admin.field}>
            <label className={admin.label} htmlFor={`roadmap-title-${i}`}>
              Next win {i + 1}
            </label>
            <input id={`roadmap-title-${i}`} className={admin.input} value={row.title} disabled={locked} maxLength={200} onChange={(e) => set(i, { title: e.target.value })} />
          </div>
          <div className={admin.field}>
            <label className={admin.label} htmlFor={`roadmap-week-${i}`}>
              Target week
            </label>
            <input
              id={`roadmap-week-${i}`}
              className={admin.input}
              inputMode="numeric"
              value={row.target_week ?? ""}
              disabled={locked}
              onChange={(e) => set(i, { target_week: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
          <div className={admin.field}>
            <label className={admin.label} htmlFor={`roadmap-champion-${i}`}>
              Champion to train
            </label>
            <input id={`roadmap-champion-${i}`} className={admin.input} value={row.champion} disabled={locked} maxLength={200} onChange={(e) => set(i, { champion: e.target.value })} />
          </div>
        </div>
      ))}
      {locked ? null : (
        <span className={styles.formRow}>
          <button type="button" className={styles.primary} disabled={pending} onClick={() => run(() => saveRoadmapAction(diagnosticId, rows))}>
            Save
          </button>
          {error ? <span className={styles.error} role="alert">{error}</span> : saved ? <span className={styles.status} role="status">Saved</span> : null}
        </span>
      )}
    </div>
  );
}

export function WriteNarrativeButton({ diagnosticId, written }: { diagnosticId: string; written: boolean }) {
  const [dropped, setDropped] = useState<number | null>(null);
  const { pending, error, run } = useDxAction();
  return (
    <span className={styles.formRow}>
      <button
        type="button"
        className={`${styles.secondary} ${styles.small}`}
        disabled={pending}
        onClick={() => {
          setDropped(null);
          run(() => generateNarrativeAction(diagnosticId), (r) => setDropped((r as { dropped?: number }).dropped ?? 0));
        }}
      >
        {pending ? "Writing" : written ? "Write it again" : "Write the narrative"}
      </button>
      {error ? (
        <span className={styles.error} role="alert">{error}</span>
      ) : dropped ? (
        <span className={styles.status} role="status">
          {dropped === 1
            ? "One section came back with a number that isn't in the readout, so it was left empty to write yourself."
            : `${dropped} sections came back with a number that isn't in the readout, so they were left empty to write yourself.`}
        </span>
      ) : null}
    </span>
  );
}

export function NarrativeFields({ diagnosticId, narrative, locked }: { diagnosticId: string; narrative: Narrative; locked: boolean }) {
  return (
    <div className={styles.body}>
      {READOUT_SECTIONS.map((s) => (
        <NarrativeField key={`${s.key}:${narrative[s.key] ?? ""}`} diagnosticId={diagnosticId} section={s.key} title={s.title} value={narrative[s.key] ?? ""} locked={locked} />
      ))}
    </div>
  );
}

function NarrativeField({ diagnosticId, section, title, value, locked }: { diagnosticId: string; section: ReadoutSection; title: string; value: string; locked: boolean }) {
  const [v, setV] = useState(value);
  const [last, setLast] = useState(value);
  const { pending, error, saved, run } = useDxAction();
  return (
    <div className={admin.field}>
      <label className={admin.label} htmlFor={`narrative-${section}`}>
        {title}
      </label>
      <textarea
        id={`narrative-${section}`}
        className={styles.textarea}
        rows={3}
        value={v}
        readOnly={locked}
        maxLength={1500}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (locked || v === last) return;
          run(() => saveNarrativeSectionAction(diagnosticId, section, v), () => setLast(v));
        }}
      />
      {error ? <span className={styles.error} role="alert">{error}</span> : pending ? <span className={styles.status}>Saving</span> : saved ? <span className={styles.status}>Saved</span> : null}
    </div>
  );
}

export function PublishButton({ diagnosticId, blocker }: { diagnosticId: string; blocker: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const { pending, error, run } = useDxAction();
  return (
    <span className={styles.formRow}>
      <button type="button" className={styles.primary} disabled={pending || Boolean(blocker)} onClick={() => setConfirming(true)}>
        Publish the readout
      </button>
      {blocker ? <span className={styles.status}>{blocker}</span> : error ? <span className={styles.error} role="alert">{error}</span> : null}
      <ConfirmDialog
        open={confirming}
        tone="primary"
        title="Publish the readout?"
        message="The readout, the notes and the quotes are fixed from now on, and the PDF shows exactly what is published. You can still record the decision."
        confirmLabel="Publish"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => run(() => publishReadoutAction(diagnosticId), () => setConfirming(false))}
      />
    </span>
  );
}

export function DecisionButtons({ diagnosticId, decision }: { diagnosticId: string; decision: Decision }) {
  const { pending, error, run } = useDxAction();
  return (
    <span className={styles.formRow}>
      {decision === "pending" ? (
        <>
          <button type="button" className={styles.primary} disabled={pending} onClick={() => run(() => recordDecisionAction(diagnosticId, "sprint"))}>
            They chose the sprint
          </button>
          <button type="button" className={styles.secondary} disabled={pending} onClick={() => run(() => recordDecisionAction(diagnosticId, "declined"))}>
            They declined
          </button>
        </>
      ) : (
        <button type="button" className={styles.secondary} disabled={pending} onClick={() => run(() => recordDecisionAction(diagnosticId, "pending"))}>
          Set back to pending
        </button>
      )}
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
    </span>
  );
}
