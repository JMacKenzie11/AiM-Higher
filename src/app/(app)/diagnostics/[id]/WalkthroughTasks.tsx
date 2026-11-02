"use client";

import { useState } from "react";
import {
  addTaskCategoryAction,
  addWalkthroughTaskAction,
  deleteTaskAction,
  deleteTaskCategoryAction,
  moveTaskCategoryAction,
  renameTaskCategoryAction,
  updateTaskAction,
  type TaskPatch,
} from "@/lib/diagnostics/actions";
import { formatHours, hoursChecked, isCandidate } from "@/lib/diagnostics/hours-back";
import { AGENT_TYPES, BUILD_EFFORTS, TASK_FREQUENCIES, toTask, type SystemLinkRow, type SystemRow, type TaskCategoryRow, type TaskRow } from "@/lib/diagnostics/types";
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
  categories = [],
  scoring = true,
}: {
  diagnosticId: string;
  tasks: TaskRow[];
  systems: SystemRow[];
  links: SystemLinkRow[];
  categories?: TaskCategoryRow[];
  // The guided Tasks screen leaves the scores to the Score tasks screen,
  // and where each task happens to the table there: systems come later,
  // as each process is taken on. It groups the tasks by category (0316);
  // the full table lists them all, with the category as a column.
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
  const table = (rows: TaskRow[]) => <TaskTable tasks={rows} systems={systems} pairs={pairs} categories={categories} scoring={scoring} />;

  if (scoring) {
    return (
      <div>
        <div className={styles.cardHeader}>
          <h4 className={styles.cardTitle}>The work done in them</h4>
          <span className={styles.cardMeta}>{tasks.length}</span>
        </div>
        <p className={styles.status}>
          Each recurring task: who does it, where, and how many hours a week. Check the biggest with units a week and minutes per unit: that is its measured baseline. Then score each one, which ranks the candidates on Build.
        </p>
        {tasks.length === 0 ? <p className={styles.empty}>No tasks yet.</p> : table(sorted)}
        <AddWalkthroughTask diagnosticId={diagnosticId} systems={systems} categoryId={null} />
      </div>
    );
  }

  const known = new Set(categories.map((c) => c.id));
  const loose = sorted.filter((t) => !t.category_id || !known.has(t.category_id));
  return (
    <div>
      <div className={styles.cardHeader}>
        <h4 className={styles.cardTitle}>The work done in them</h4>
        <span className={styles.cardMeta}>{tasks.length}</span>
      </div>
      <p className={styles.status}>
        Each recurring task: who does it and how many hours a week. Add a category, such as Outreach, to group tasks under it. Check the biggest with units a week and minutes per unit: that is its measured baseline. Then score each one, which ranks the candidates on Build.
      </p>
      {categories.map((c, i) => {
        const rows = sorted.filter((t) => t.category_id === c.id);
        return (
          <section key={c.id} className={styles.category} aria-label={c.name}>
            <CategoryHead category={c} first={i === 0} last={i === categories.length - 1} count={rows.length} />
            {rows.length === 0 ? <p className={styles.empty}>No tasks in {c.name} yet.</p> : table(rows)}
            <AddWalkthroughTask diagnosticId={diagnosticId} systems={null} categoryId={c.id} categoryName={c.name} />
          </section>
        );
      })}
      {categories.length === 0 || loose.length > 0 ? (
        <section className={categories.length ? styles.category : undefined} aria-label={categories.length ? "No category" : undefined}>
          {categories.length ? <h5 className={styles.categoryName}>No category</h5> : null}
          {loose.length === 0 ? <p className={styles.empty}>No tasks yet.</p> : table(loose)}
          {categories.length === 0 ? <AddWalkthroughTask diagnosticId={diagnosticId} systems={null} categoryId={null} /> : null}
        </section>
      ) : null}
      <AddCategory diagnosticId={diagnosticId} />
    </div>
  );
}

function TaskTable({
  tasks,
  systems,
  pairs,
  categories,
  scoring,
}: {
  tasks: TaskRow[];
  systems: SystemRow[];
  pairs: Array<{ value: string; label: string }>;
  categories: TaskCategoryRow[];
  scoring: boolean;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Task</th>
            <th>Who does it</th>
            {categories.length ? <th>Category</th> : null}
            {scoring ? (
              <>
                <th>Where</th>
                <th>Copies information</th>
              </>
            ) : null}
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
          {tasks.map((t) => (
            <TaskEditor key={t.id} task={t} systems={systems} pairs={pairs} categories={categories} scoring={scoring} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A category's name (saved when the cursor leaves it), its place in the
// order, and Remove, which keeps its tasks with no category.
function CategoryHead({ category, first, last, count }: { category: TaskCategoryRow; first: boolean; last: boolean; count: number }) {
  const { pending, error, run } = useDxAction();
  return (
    <div className={styles.categoryHead} aria-busy={pending || undefined}>
      <Cell value={category.name} label={`Category name for ${category.name}`} onSave={(v) => run(() => renameTaskCategoryAction(category.id, v))} maxLength={120} />
      <span className={styles.cardMeta}>{count}</span>
      <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={pending || first} onClick={() => run(() => moveTaskCategoryAction(category.id, -1))} aria-label={`Move ${category.name} up`}>
        Up
      </button>
      <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={pending || last} onClick={() => run(() => moveTaskCategoryAction(category.id, 1))} aria-label={`Move ${category.name} down`}>
        Down
      </button>
      <button
        type="button"
        className={`${styles.secondary} ${styles.small}`}
        disabled={pending}
        onClick={() => {
          if (count === 0 || window.confirm(`Remove ${category.name}? Its tasks stay, with no category.`)) run(() => deleteTaskCategoryAction(category.id));
        }}
        aria-label={`Remove ${category.name}`}
      >
        Remove
      </button>
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
    </div>
  );
}

function AddCategory({ diagnosticId }: { diagnosticId: string }) {
  const [name, setName] = useState("");
  const { pending, error, run } = useDxAction();
  return (
    <div className={`${styles.body} ${styles.category}`}>
      <div className={styles.formRow}>
        <input className={`${styles.cellInput} ${styles.cellWide}`} aria-label="New category" placeholder="Category, such as Outreach" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        <button
          type="button"
          className={`${styles.secondary} ${styles.small}`}
          disabled={pending || !name.trim()}
          onClick={() => run(() => addTaskCategoryAction(diagnosticId, name), () => setName(""))}
        >
          Add a category
        </button>
        {error ? <span className={styles.error} role="alert">{error}</span> : null}
      </div>
    </div>
  );
}

function TaskEditor({
  task,
  systems,
  pairs,
  categories,
  scoring,
}: {
  task: TaskRow;
  systems: SystemRow[];
  pairs: Array<{ value: string; label: string }>;
  categories: TaskCategoryRow[];
  scoring: boolean;
}) {
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
        <Cell value={task.title} label={`Task title for ${name}`} wide tall maxLength={300} onSave={(v) => save({ title: v })} />
        {error ? <span className={styles.error} role="alert">{error}</span> : null}
      </td>
      <td>
        <Cell value={task.role_title ?? ""} label={`Who does ${name}`} tall maxLength={120} onSave={(v) => save({ role_title: v })} />
      </td>
      {categories.length ? (
        <td>
          <select className={styles.cellInput} aria-label={`Category for ${name}`} value={task.category_id ?? ""} onChange={(e) => save({ category_id: e.target.value || null })}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </td>
      ) : null}
      {scoring ? (
      <>
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
      </>
      ) : null}
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

// systems null: no Where (the Tasks screen). A task added under a
// category goes in it.
function AddWalkthroughTask({
  diagnosticId,
  systems,
  categoryId,
  categoryName,
}: {
  diagnosticId: string;
  systems: SystemRow[] | null;
  categoryId: string | null;
  categoryName?: string;
}) {
  const blank = { title: "", role: "", system: "", hours: "" };
  const [f, setF] = useState(blank);
  const { pending, error, run } = useDxAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className={styles.body}>
      <div className={styles.formRow}>
        <textarea
          className={`${styles.cellInput} ${styles.cellWide} ${styles.cellTall}`}
          aria-label={categoryName ? `New task in ${categoryName}` : "New task"}
          placeholder="Task"
          rows={3}
          value={f.title}
          onChange={set("title")}
          maxLength={300}
        />
        <textarea
          className={`${styles.cellInput} ${styles.cellTall}`}
          aria-label={categoryName ? `Who does the new task in ${categoryName}` : "Who does the new task"}
          placeholder="Who does it"
          rows={3}
          value={f.role}
          onChange={set("role")}
          maxLength={120}
        />
        {systems ? (
          <select className={styles.cellInput} aria-label="Where the new task happens" value={f.system} onChange={set("system")}>
            <option value="">Where</option>
            {systems.map((sys) => (
              <option key={sys.id} value={sys.id}>
                {sys.name}
              </option>
            ))}
          </select>
        ) : null}
        <input className={styles.cellInput} aria-label={categoryName ? `Hours a week for the new task in ${categoryName}` : "Hours a week for the new task"} placeholder="Hours a week" inputMode="decimal" value={f.hours} onChange={set("hours")} />
        <button
          type="button"
          className={`${styles.secondary} ${styles.small}`}
          aria-label={categoryName ? `Add a task to ${categoryName}` : undefined}
          disabled={pending || !f.title.trim()}
          onClick={() =>
            run(
              () => addWalkthroughTaskAction(diagnosticId, { title: f.title, role_title: f.role, hours_per_week: f.hours, system_id: (systems && f.system) || null, category_id: categoryId }),
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
