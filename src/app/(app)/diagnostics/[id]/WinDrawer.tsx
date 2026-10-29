"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { saveFirstWinAction, type WinInput } from "@/lib/diagnostics/actions";
import { WIN_PATTERNS, winPattern } from "@/lib/diagnostics/win-patterns";
import { isCandidate } from "@/lib/diagnostics/hours-back";
import { taskWho, toTask, type ParticipantRow, type TaskRow, type WinRow } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// Choose the first win, then record its measured week. A pattern from
// the library, the task it serves, and the baseline: minutes per unit
// before, units a week. Once it is in use, the measurement opens: the
// minutes per unit after, over its first full working week (ending on
// a Friday).

export function WinButton(props: { diagnosticId: string; win: WinRow | null; tasks: TaskRow[]; participants: ParticipantRow[]; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setOpen(true)}>
        {props.label}
      </button>
      {open ? <WinDrawer {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const s = (v: number | string | null | undefined) => (v == null ? "" : String(v));

function WinDrawer({
  diagnosticId,
  win,
  tasks,
  participants,
  onClose,
}: {
  diagnosticId: string;
  win: WinRow | null;
  tasks: TaskRow[];
  participants: ParticipantRow[];
  onClose: () => void;
}) {
  const names = new Map(participants.map((p) => [p.id, p.name]));
  // Candidates first, biggest first: the first win comes from there.
  const options = [...tasks].sort(
    (a, b) => Number(isCandidate(toTask(b))) - Number(isCandidate(toTask(a))) || Number(b.hours_per_week) - Number(a.hours_per_week)
  );
  const [f, setF] = useState<Required<{ [K in keyof WinInput]: string }>>({
    task_id: win?.task_id ?? options[0]?.id ?? "",
    pattern: win?.pattern ?? WIN_PATTERNS[0].slug,
    title: win?.title ?? "",
    built_at: s(win?.built_at),
    in_use_from: s(win?.in_use_from),
    baseline_minutes_per_unit: s(win?.baseline_minutes_per_unit),
    after_minutes_per_unit: s(win?.after_minutes_per_unit),
    units_per_week: s(win?.units_per_week),
    measured_week_ending: s(win?.measured_week_ending),
  });
  const { pending, error, run } = useDxAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pattern = winPattern(f.pattern);

  const input = (k: keyof typeof f, label: string, type: "text" | "date" = "text", hint?: string) => (
    <div className={admin.field}>
      <label className={admin.label} htmlFor={`win-${k}`}>
        {label}
      </label>
      <input id={`win-${k}`} className={admin.input} type={type} inputMode={type === "text" && k !== "title" ? "decimal" : undefined} value={f[k]} onChange={set(k)} />
      {hint ? <span className={styles.status}>{hint}</span> : null}
    </div>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      name="diagnostic-win"
      eyebrow="First win"
      title={win ? win.title : "Choose the first win"}
      footer={
        <>
          <button type="button" className={styles.primary} disabled={pending} onClick={() => run(() => saveFirstWinAction(diagnosticId, f), onClose)}>
            Save
          </button>
          <button type="button" className={styles.secondary} disabled={pending} onClick={onClose}>
            Cancel
          </button>
          {error ? <span className={styles.error} role="alert">{error}</span> : null}
        </>
      }
    >
      <div className={styles.body}>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="win-pattern">
            Pattern
          </label>
          <select id="win-pattern" className={admin.select} value={f.pattern} onChange={set("pattern")}>
            {WIN_PATTERNS.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
          </select>
          {pattern ? (
            <span className={styles.status}>
              {pattern.whatItDoes} Measure: {pattern.measure} Needs: {pattern.needs}
            </span>
          ) : null}
        </div>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="win-task">
            The task it serves
          </label>
          <select id="win-task" className={admin.select} value={f.task_id} onChange={set("task_id")}>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.canonical_title || t.title}, {taskWho(t, names)}
                {isCandidate(toTask(t)) ? "" : " (not a candidate)"}
              </option>
            ))}
          </select>
        </div>
        {input("title", "Name of the build", "text", pattern ? `Leave blank to call it "${pattern.title}".` : undefined)}
        <div className={styles.grid2}>
          {input("baseline_minutes_per_unit", "Minutes per unit before")}
          {input("units_per_week", "Units a week")}
          {input("built_at", "Built on", "date")}
          {input("in_use_from", "In use from", "date")}
        </div>
        {f.in_use_from ? (
          <div className={styles.grid2}>
            {input("after_minutes_per_unit", "Minutes per unit after")}
            {input("measured_week_ending", "Measured week ending", "date", "A Friday: the first full working week in use.")}
          </div>
        ) : (
          <p className={styles.muted}>The measurement opens once the build is in use.</p>
        )}
      </div>
    </Drawer>
  );
}
