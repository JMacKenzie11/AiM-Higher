"use client";

import { useEffect, useState, type ReactNode } from "react";
import { addTaskAction, deleteTaskAction, rollUpTitlesAction, updateTaskAction, type TaskPatch } from "@/lib/diagnostics/actions";
import { formatHours, hoursChecked, isCandidate } from "@/lib/diagnostics/hours-back";
import { taskWho, toTask, type ParticipantRow, type TaskRow } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import styles from "../diagnostics.module.css";

// Every task from every person in one table. The lead corrects a row,
// adds one (source "lead"), enters the volume check against the
// biggest tasks (units a week, minutes per unit), and rolls the same
// work up under one title. Each cell saves when the cursor leaves it.

const SOURCE_LABEL: Record<TaskRow["source"], string> = { survey: "Survey", conversation: "Conversation", lead: "Added" };

export function TaskGrid({
  diagnosticId,
  participants,
  tasks,
  footer,
}: {
  diagnosticId: string;
  participants: ParticipantRow[];
  tasks: TaskRow[];
  footer: ReactNode;
}) {
  const roll = useDxAction();
  const names = new Map(participants.map((p) => [p.id, p.name]));
  // Biggest first, so the volume check goes against the tasks worth checking.
  const sorted = [...tasks].sort((a, b) => Number(b.hours_per_week) - Number(a.hours_per_week));
  const unnamed = tasks.filter((t) => !t.canonical_title).length;

  return (
    <section className={styles.card} aria-labelledby="task-grid">
      <div className={styles.cardHeader}>
        <h2 id="task-grid" className={styles.cardTitle}>
          Every task
        </h2>
        <span className={styles.cardMeta}>{tasks.length}</span>
        <span className={styles.headerAction}>
          <span className={styles.formRow}>
            {roll.error ? <span className={styles.error} role="alert">{roll.error}</span> : null}
            <button
              type="button"
              className={`${styles.secondary} ${styles.small}`}
              disabled={roll.pending || unnamed === 0}
              onClick={() => roll.run(() => rollUpTitlesAction(diagnosticId))}
            >
              {roll.pending ? "Rolling up" : "Roll up titles"}
            </button>
          </span>
        </span>
      </div>
      {tasks.length === 0 ? (
        <p className={styles.empty}>Tasks appear here as surveys are entered.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Task</th>
                <th>Rolls up as</th>
                <th className={styles.num}>Reported hours</th>
                <th>Energy</th>
                <th>Judgment</th>
                <th className={styles.num}>Units a week</th>
                <th className={styles.num}>Minutes per unit</th>
                <th className={styles.num}>Checked hours</th>
                <th>Data risk</th>
                <th className={styles.num}>Build hours</th>
                <th>Candidate</th>
                <th>From</th>
                <th>
                  <span className={styles.srOnly}>Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <TaskRowEditor key={t.id} task={t} person={taskWho(t, names)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {participants.length > 0 ? <AddTask diagnosticId={diagnosticId} participants={participants} /> : null}
      <div className={styles.cardFooter}>{footer}</div>
    </section>
  );
}

export function Cell({
  value,
  label,
  onSave,
  wide = false,
  numeric = false,
}: {
  value: string;
  label: string;
  onSave: (v: string) => void;
  wide?: boolean;
  numeric?: boolean;
}) {
  const [v, setV] = useState(value);
  // A save elsewhere (the title roll-up) changes the row under it.
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={`${styles.cellInput} ${wide ? styles.cellWide : ""}`}
      aria-label={label}
      value={v}
      inputMode={numeric ? "decimal" : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
    />
  );
}

function TaskRowEditor({ task, person }: { task: TaskRow; person: string }) {
  const { pending, error, run } = useDxAction();
  const save = (patch: TaskPatch) => run(() => updateTaskAction(task.id, patch));
  const s = (v: number | null) => (v == null ? "" : String(v));
  const checked = hoursChecked(toTask(task));
  const candidate = isCandidate(toTask(task));
  const override = task.candidate_override == null ? "auto" : task.candidate_override ? "yes" : "no";
  const name = task.title;
  const rating = (k: "energy" | "judgment") => (
    <select className={styles.cellInput} aria-label={`${k === "energy" ? "Energy" : "Judgment"} for ${name}`} value={task[k] ?? ""} onChange={(e) => save({ [k]: e.target.value })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );

  return (
    <tr aria-busy={pending || undefined}>
      <td>{person}</td>
      <td>
        <Cell value={task.title} label={`Task title for ${name}`} wide onSave={(v) => save({ title: v })} />
        {error ? <span className={styles.error} role="alert">{error}</span> : null}
      </td>
      <td>
        <Cell value={task.canonical_title ?? ""} label={`Rolls up as, for ${name}`} wide onSave={(v) => save({ canonical_title: v })} />
      </td>
      <td>
        <Cell value={s(task.hours_per_week)} label={`Reported hours for ${name}`} numeric onSave={(v) => save({ hours_per_week: v })} />
      </td>
      <td>{rating("energy")}</td>
      <td>{rating("judgment")}</td>
      <td>
        <Cell value={s(task.volume_units_per_week)} label={`Units a week for ${name}`} numeric onSave={(v) => save({ volume_units_per_week: v })} />
      </td>
      <td>
        <Cell value={s(task.minutes_per_unit)} label={`Minutes per unit for ${name}`} numeric onSave={(v) => save({ minutes_per_unit: v })} />
      </td>
      <td className={styles.num}>{checked == null ? "" : formatHours(checked)}</td>
      <td>
        <select className={styles.cellInput} aria-label={`Data risk for ${name}`} value={task.data_risk ?? ""} onChange={(e) => save({ data_risk: e.target.value || null })}>
          <option value="">Not set</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </td>
      <td>
        <Cell value={s(task.build_effort_hours)} label={`Build hours for ${name}`} numeric onSave={(v) => save({ build_effort_hours: v })} />
      </td>
      <td>
        <select
          className={styles.cellInput}
          aria-label={`Candidate for ${name}`}
          value={override}
          onChange={(e) => save({ candidate_override: e.target.value as "auto" | "yes" | "no" })}
        >
          <option value="auto">{candidate && override === "auto" ? "Yes, by rule" : override === "auto" ? "No, by rule" : "By rule"}</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </td>
      <td className={styles.muted}>{SOURCE_LABEL[task.source]}</td>
      <td>
        <button
          type="button"
          className={`${styles.secondary} ${styles.small}`}
          disabled={pending}
          onClick={() => run(() => deleteTaskAction(task.id))}
          aria-label={`Remove ${name}`}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

function AddTask({ diagnosticId, participants }: { diagnosticId: string; participants: ParticipantRow[] }) {
  const blank = { participant: participants[0]?.id ?? "", title: "", hours: "", energy: "", judgment: "" };
  const [f, setF] = useState(blank);
  const { pending, error, run } = useDxAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className={styles.body}>
      <div className={styles.formRow}>
        <select className={styles.cellInput} aria-label="Person for the new task" value={f.participant} onChange={set("participant")}>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input className={`${styles.cellInput} ${styles.cellWide}`} aria-label="New task" placeholder="Task" value={f.title} onChange={set("title")} maxLength={300} />
        <input className={styles.cellInput} aria-label="Hours a week for the new task" placeholder="Hours" inputMode="decimal" value={f.hours} onChange={set("hours")} />
        {(["energy", "judgment"] as const).map((k) => (
          <select key={k} className={styles.cellInput} aria-label={`${k === "energy" ? "Energy" : "Judgment"} for the new task`} value={f[k]} onChange={set(k)}>
            <option value="">{k === "energy" ? "Energy" : "Judgment"}</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ))}
        <button
          type="button"
          className={`${styles.secondary} ${styles.small}`}
          disabled={pending || !f.title.trim()}
          onClick={() =>
            run(
              () => addTaskAction(diagnosticId, f.participant, { title: f.title, hours_per_week: f.hours, energy: f.energy, judgment: f.judgment }),
              () => setF({ ...blank, participant: f.participant })
            )
          }
        >
          Add a task
        </button>
        {error ? <span className={styles.error} role="alert">{error}</span> : null}
      </div>
    </div>
  );
}
