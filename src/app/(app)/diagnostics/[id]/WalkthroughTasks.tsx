"use client";

import { useState } from "react";
import { addWalkthroughTaskAction, deleteTaskAction, updateTaskAction, type TaskPatch } from "@/lib/diagnostics/actions";
import { formatHours, hoursChecked, isCandidate } from "@/lib/diagnostics/hours-back";
import { AGENT_TYPES, BUILD_EFFORTS, TASK_FREQUENCIES, toTask, type SystemLinkRow, type SystemRow, type TaskRow } from "@/lib/diagnostics/types";
import { taskEffort } from "@/lib/diagnostics/hours-back";
import { useDxAction } from "../useDxAction";
import { Cell } from "./TaskGrid";
import styles from "../diagnostics.module.css";

// THE WORK DONE IN THE SYSTEMS (0305), on Pre-flight under the
// walkthrough, while the people interviews are hidden. The lead enters
// each recurring task as the IT or admin contact describes it: what it
// is, the role that does it, the system it happens in, the link it
// copies information along, and its hours. The volume check and the
// scoring (0309: how often, data risk, build effort, whether a person
// must approve it, and the kind of agent that would do it) go in the
// same row. Each cell saves when the cursor leaves it, each choice at
// once.

export function WalkthroughTasks({
  diagnosticId,
  tasks,
  systems,
  links,
  scoring = true,
}: {
  diagnosticId: string;
  tasks: TaskRow[];
  systems: SystemRow[];
  links: SystemLinkRow[];
  // The guided Tasks screen leaves the scores to the Score tasks screen.
  scoring?: boolean;
}) {
  const systemName = new Map(systems.map((s) => [s.id, s.name]));
  // What a task can copy along: each link's direction, once.
  const pairs = [...new Map(links.map((l) => [`${l.from_system_id}>${l.to_system_id}`, l])).values()].map((l) => ({
    value: `${l.from_system_id}>${l.to_system_id}`,
    label: `${systemName.get(l.from_system_id) ?? "Unknown"} to ${systemName.get(l.to_system_id) ?? "Unknown"}`,
  }));
  // Biggest first, so the volume check goes against the tasks worth checking.
  const sorted = [...tasks].sort((a, b) => Number(b.hours_per_week) - Number(a.hours_per_week));

  return (
    <div>
      <div className={styles.cardHeader}>
        <h4 className={styles.cardTitle}>The work done in them</h4>
        <span className={styles.cardMeta}>{tasks.length}</span>
      </div>
      <p className={styles.status}>
        Each recurring task: who does it, where, and how many hours a week. Check the biggest with units a week and minutes per unit: that is its measured baseline. Then score each one, which ranks the candidates on Build.
      </p>
      {tasks.length === 0 ? (
        <p className={styles.empty}>No tasks yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Task</th>
                <th>Who does it</th>
                <th>Where</th>
                <th>Copies information</th>
                <th className={styles.num}>Hours a week</th>
                <th className={styles.num}>Units a week</th>
                <th className={styles.num}>Minutes per unit</th>
                <th className={styles.num}>Baseline (measured)</th>
                {scoring ? (
                  <>
                    <th>How often</th>
                    <th>Data risk</th>
                    <th>Build effort</th>
                    <th>Needs approval</th>
                    <th>Agent type</th>
                  </>
                ) : null}
                <th>Candidate</th>
                <th>
                  <span className={styles.srOnly}>Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <TaskEditor key={t.id} task={t} systems={systems} pairs={pairs} scoring={scoring} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddWalkthroughTask diagnosticId={diagnosticId} systems={systems} />
    </div>
  );
}

function TaskEditor({ task, systems, pairs, scoring }: { task: TaskRow; systems: SystemRow[]; pairs: Array<{ value: string; label: string }>; scoring: boolean }) {
  const { pending, error, run } = useDxAction();
  const save = (patch: TaskPatch) => run(() => updateTaskAction(task.id, patch));
  const s = (v: number | null) => (v == null ? "" : String(v));
  const checked = hoursChecked(toTask(task));
  const override = task.candidate_override == null ? "auto" : task.candidate_override ? "yes" : "no";
  const name = task.title;
  const pair = task.copies_from_system_id && task.copies_to_system_id ? `${task.copies_from_system_id}>${task.copies_to_system_id}` : "";
  // A pair saved before its link was removed still shows, so the select
  // never claims "No" for a task that copies.
  const options = pair && !pairs.some((p) => p.value === pair) ? [...pairs, { value: pair, label: "A link no longer listed" }] : pairs;

  return (
    <tr aria-busy={pending || undefined}>
      <td>
        <Cell value={task.title} label={`Task title for ${name}`} wide onSave={(v) => save({ title: v })} />
        {error ? <span className={styles.error} role="alert">{error}</span> : null}
      </td>
      <td>
        <Cell value={task.role_title ?? ""} label={`Who does ${name}`} onSave={(v) => save({ role_title: v })} />
      </td>
      <td>
        <select className={styles.cellInput} aria-label={`Where ${name} happens`} value={task.system_id ?? ""} onChange={(e) => save({ system_id: e.target.value || null })}>
          <option value="">Not set</option>
          {systems.map((sys) => (
            <option key={sys.id} value={sys.id}>
              {sys.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          className={styles.cellInput}
          aria-label={`Information ${name} copies`}
          value={pair}
          disabled={options.length === 0}
          onChange={(e) => {
            const [from, to] = e.target.value ? e.target.value.split(">") : [null, null];
            save({ copies_from_system_id: from, copies_to_system_id: to });
          }}
        >
          <option value="">{options.length === 0 ? "Add a link first" : "No"}</option>
          {options.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <Cell value={s(task.hours_per_week)} label={`Hours a week for ${name}`} numeric onSave={(v) => save({ hours_per_week: v })} />
      </td>
      <td>
        <Cell value={s(task.volume_units_per_week)} label={`Units a week for ${name}`} numeric onSave={(v) => save({ volume_units_per_week: v })} />
      </td>
      <td>
        <Cell value={s(task.minutes_per_unit)} label={`Minutes per unit for ${name}`} numeric onSave={(v) => save({ minutes_per_unit: v })} />
      </td>
      <td className={styles.num}>{checked == null ? "" : formatHours(checked)}</td>
      {scoring ? (
      <>
      <td>
        <Choice label={`How often for ${name}`} value={task.frequency} options={TASK_FREQUENCIES} onChange={(v) => save({ frequency: v })} />
      </td>
      <td>
        <select className={styles.cellInput} aria-label={`Data risk for ${name}`} value={task.data_risk ?? ""} onChange={(e) => save({ data_risk: e.target.value || null })}>
          <option value="">Not set</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </td>
      <td>
        <Choice label={`Build effort for ${name}`} value={taskEffort(toTask(task))} options={BUILD_EFFORTS} onChange={(v) => save({ build_effort: v })} />
      </td>
      <td>
        <select
          className={styles.cellInput}
          aria-label={`Needs approval for ${name}`}
          value={task.needs_approval == null ? "" : task.needs_approval ? "yes" : "no"}
          onChange={(e) => save({ needs_approval: e.target.value === "" ? null : e.target.value === "yes" })}
        >
          <option value="">Not set</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </td>
      <td>
        <Choice label={`Agent type for ${name}`} value={task.agent_type} options={AGENT_TYPES} onChange={(v) => save({ agent_type: v })} />
      </td>
      </>
      ) : null}
      <td>
        <select
          className={styles.cellInput}
          aria-label={`Candidate for ${name}`}
          value={override}
          onChange={(e) => save({ candidate_override: e.target.value as "auto" | "yes" | "no" })}
        >
          <option value="auto">{isCandidate(toTask(task)) ? "Yes" : "No"}</option>
          <option value="no">No, leave it out</option>
        </select>
      </td>
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

function AddWalkthroughTask({ diagnosticId, systems }: { diagnosticId: string; systems: SystemRow[] }) {
  const blank = { title: "", role: "", system: "", hours: "" };
  const [f, setF] = useState(blank);
  const { pending, error, run } = useDxAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className={styles.body}>
      <div className={styles.formRow}>
        <input className={`${styles.cellInput} ${styles.cellWide}`} aria-label="New task" placeholder="Task" value={f.title} onChange={set("title")} maxLength={300} />
        <input className={styles.cellInput} aria-label="Who does the new task" placeholder="Who does it" value={f.role} onChange={set("role")} maxLength={120} />
        <select className={styles.cellInput} aria-label="Where the new task happens" value={f.system} onChange={set("system")}>
          <option value="">Where</option>
          {systems.map((sys) => (
            <option key={sys.id} value={sys.id}>
              {sys.name}
            </option>
          ))}
        </select>
        <input className={styles.cellInput} aria-label="Hours a week for the new task" placeholder="Hours a week" inputMode="decimal" value={f.hours} onChange={set("hours")} />
        <button
          type="button"
          className={`${styles.secondary} ${styles.small}`}
          disabled={pending || !f.title.trim()}
          onClick={() =>
            run(
              () => addWalkthroughTaskAction(diagnosticId, { title: f.title, role_title: f.role, hours_per_week: f.hours, system_id: f.system || null }),
              () => setF({ ...blank, role: f.role, system: f.system })
            )
          }
        >
          Add a task
        </button>
        {error ? <span className={styles.error} role="alert">{error}</span> : !f.title.trim() ? <span className={styles.status}>Enter a task name to add it.</span> : null}
      </div>
    </div>
  );
}

// One of the scoring choices, saved at once.
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string | null) => void;
}) {
  return (
    <select className={styles.cellInput} aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Not set</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
