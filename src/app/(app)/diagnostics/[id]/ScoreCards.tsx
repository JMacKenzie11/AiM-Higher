"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { updateTaskAction, type TaskPatch } from "@/lib/diagnostics/actions";
import { taskEffort } from "@/lib/diagnostics/hours-back";
import { taskScored } from "@/lib/diagnostics/screens";
import { AGENT_TYPES, BUILD_EFFORTS, TASK_FREQUENCIES, toTask, type SystemLinkRow, type SystemRow, type TaskRow } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import { WalkthroughTasks } from "./WalkthroughTasks";
import styles from "../diagnostics.module.css";

// SCORING THE TASKS AS CARDS (the guided screens; Jason, 2026-10-29,
// approved mockup). One card per task: name, who, where, hours a week,
// and the five scores as rows of chips. Chips are buttons with
// aria-pressed; each pick saves at once and moves to the next row. In
// the card, keys 1 to 9 pick in the highlighted row and Enter goes to
// the next task. "Skip for now" moves on without scoring. The table
// view is the full task table, for scoring many at once.

type Group = { field: keyof TaskPatch; label: string; options: ReadonlyArray<{ value: string; label: string }>; read: (t: TaskRow) => string | null };

const GROUPS: Group[] = [
  { field: "frequency", label: "How often", options: TASK_FREQUENCIES, read: (t) => t.frequency },
  {
    field: "data_risk",
    label: "Data risk",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    read: (t) => t.data_risk,
  },
  { field: "build_effort", label: "Build effort", options: BUILD_EFFORTS, read: (t) => taskEffort(toTask(t)) },
  { field: "agent_type", label: "Agent type", options: AGENT_TYPES, read: (t) => t.agent_type },
  {
    field: "needs_approval",
    label: "Needs human approval",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
    read: (t) => (t.needs_approval == null ? null : t.needs_approval ? "yes" : "no"),
  },
];

export function ScoreCards({
  diagnosticId,
  tasks,
  systems,
  links,
}: {
  diagnosticId: string;
  tasks: TaskRow[];
  systems: SystemRow[];
  links: SystemLinkRow[];
}) {
  const [view, setView] = useState<"cards" | "table">("cards");
  // Biggest first, as the table: the scores that matter most come first.
  const order = useMemo(() => [...tasks].sort((a, b) => Number(b.hours_per_week) - Number(a.hours_per_week)), [tasks]);
  const firstToScore = Math.max(0, order.findIndex((t) => !taskScored(t)));
  const [at, setAt] = useState(firstToScore);
  const [row, setRow] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  // What was picked here, shown at once while the save lands.
  const [picked, setPicked] = useState<Record<string, Partial<Record<keyof TaskPatch, string>>>>({});
  const { pending, error, run } = useDxAction();

  const systemName = new Map(systems.map((s) => [s.id, s.name]));
  const scoredCount = order.filter((t) => isScored(t)).length;
  const cur = order[Math.min(at, order.length - 1)];

  function value(t: TaskRow, g: Group): string | null {
    return picked[t.id]?.[g.field] ?? g.read(t);
  }
  function isScored(t: TaskRow): boolean {
    return GROUPS.every((g) => value(t, g) != null);
  }
  function go(i: number) {
    if (order.length === 0) return;
    setAt((i + order.length) % order.length);
    setRow(0);
  }
  function pick(gi: number, v: string) {
    const g = GROUPS[gi];
    setPicked((p) => ({ ...p, [cur.id]: { ...p[cur.id], [g.field]: v } }));
    setSkipped((s) => s.filter((id) => id !== cur.id));
    const patch: TaskPatch = g.field === "needs_approval" ? { needs_approval: v === "yes" } : ({ [g.field]: v } as TaskPatch);
    run(() => updateTaskAction(cur.id, patch));
    setRow(Math.min(gi + 1, GROUPS.length - 1));
  }
  function onKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      go(at + 1);
      return;
    }
    const n = Number(e.key);
    const g = GROUPS[row];
    if (Number.isInteger(n) && n >= 1 && n <= g.options.length) {
      e.preventDefault();
      pick(row, g.options[n - 1].value);
    }
  }

  const where = (t: TaskRow) =>
    t.copies_from_system_id && t.copies_to_system_id
      ? `${systemName.get(t.copies_from_system_id) ?? "?"} to ${systemName.get(t.copies_to_system_id) ?? "?"}`
      : t.system_id
        ? systemName.get(t.system_id) ?? ""
        : "";

  return (
    <div className={styles.body}>
      <div className={styles.scoreHead}>
        <span className={styles.scoreCount}>
          Scored {scoredCount} of {order.length}
          {skipped.length ? <span className={styles.status}>, {skipped.length} skipped</span> : null}
        </span>
        <div className={styles.progress} aria-hidden="true">
          <div style={{ width: `${order.length ? Math.round((scoredCount / order.length) * 100) : 0}%` }} />
        </div>
        <div role="group" aria-label="View" className={styles.segmented}>
          <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
            Cards
          </button>
          <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
            Table view
          </button>
        </div>
      </div>

      {view === "table" ? (
        <WalkthroughTasks diagnosticId={diagnosticId} tasks={tasks} systems={systems} links={links} />
      ) : order.length === 0 ? (
        <p className={styles.empty}>No tasks yet. Add them on the Tasks screen.</p>
      ) : (
        <div className={styles.scoreLayout}>
          <section tabIndex={0} aria-labelledby="score-card-title" onKeyDown={onKey} className={styles.scoreCard}>
            <div className={styles.scoreCardHead}>
              <div>
                <div className={styles.status}>
                  Task {at + 1} of {order.length}
                </div>
                <h3 id="score-card-title" className={styles.cardTitle}>
                  {cur.title}
                </h3>
                <div className={styles.status}>{[cur.role_title, where(cur)].filter(Boolean).join(" · ")}</div>
              </div>
              <div className={styles.scoreHours}>
                <span className={styles.figureValue}>{Number(cur.hours_per_week)}</span>
                <span className={styles.status}>hours a week</span>
              </div>
            </div>

            {GROUPS.map((g, gi) => (
              <fieldset key={g.field} className={styles.chipRow} data-active={gi === row ? "true" : undefined}>
                <legend>
                  {g.label} {gi === row ? <span className={styles.status}>(keys 1 to {g.options.length})</span> : null}
                </legend>
                <div className={styles.chips}>
                  {g.options.map((o, oi) => {
                    const on = value(cur, g) === o.value;
                    return (
                      <button key={o.value} type="button" aria-pressed={on} className={styles.chipButton} onClick={() => pick(gi, o.value)}>
                        <span aria-hidden="true" className={styles.chipKey}>
                          {oi + 1}
                        </span>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}

            <p className={styles.status}>Keys: 1 to 9 pick in the highlighted row, then it moves on. Enter goes to the next task.</p>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            <div className={styles.screenFooter}>
              <button type="button" className={styles.secondary} onClick={() => go(at - 1)} disabled={pending && order.length < 2}>
                Previous task
              </button>
              <span className={styles.formRow}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    if (!isScored(cur)) setSkipped((s) => (s.includes(cur.id) ? s : [...s, cur.id]));
                    go(at + 1);
                  }}
                >
                  Skip for now
                </button>
                <button type="button" className={styles.primary} onClick={() => go(at + 1)}>
                  Next task
                </button>
              </span>
            </div>
          </section>

          <section aria-labelledby="score-queue" className={styles.scoreQueue}>
            <h3 id="score-queue" className={styles.cardTitle}>
              All {order.length} tasks
            </h3>
            <ol>
              {order.map((t, i) => {
                const state = isScored(t) ? "Scored" : skipped.includes(t.id) ? "Skipped" : "To score";
                return (
                  <li key={t.id}>
                    <button type="button" aria-current={i === at ? "step" : undefined} onClick={() => go(i)}>
                      <span>{t.title}</span>
                      <span className={`${styles.chip} ${state === "Scored" ? "" : state === "Skipped" ? styles.chipWarn : styles.chipMuted}`}>{state}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
