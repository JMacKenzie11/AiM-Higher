"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { saveSurveyAction, type SurveyInput, type SurveyTaskInput } from "@/lib/diagnostics/actions";
import { MAX_TASKS_PER_PARTICIPANT } from "@/lib/diagnostics/hours-back";
import type { AnswerRow, ParticipantRow, TaskRow } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// The Capacity and Energy Survey, one person at a time, entered by the
// assessor. After a save the drawer stays open on the next person
// without a survey, as the invite drawer does on Team, so a batch of
// paper or call notes goes in without reopening it.

export const OPEN_QUESTIONS = [
  { key: "best_work", label: "What part of your work are you best at, and when did you last get a full day of it?" },
  { key: "task_to_lose", label: "If one task disappeared from your week tomorrow, which one, and what would you do with the time?" },
  { key: "trust_needs", label: "What would you need to hear or see to trust a tool with that task?" },
] as const;

type Props = { participants: ParticipantRow[]; tasks: TaskRow[]; answers: AnswerRow[] };

export function SurveyButton({ label, startWith, ...props }: Props & { label: string; startWith: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? <SurveyDrawer {...props} startWith={startWith} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SurveyDrawer({ participants, tasks, answers, startWith, onClose }: Props & { startWith: string; onClose: () => void }) {
  const [current, setCurrent] = useState(startWith);
  const [done, setDone] = useState<string | null>(null);
  const person = participants.find((p) => p.id === current);
  if (!person) return null;

  function afterSave() {
    setDone(person!.name);
    const next = participants.find((p) => p.id !== current && !p.survey_entered_at);
    if (next) setCurrent(next.id);
  }

  return (
    <Drawer open onClose={onClose} name="diagnostic-survey" eyebrow="Capacity and Energy Survey" title={person.name}>
      <div className={styles.body}>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="survey-person">
            Person
          </label>
          <select id="survey-person" className={admin.select} value={current} onChange={(e) => { setCurrent(e.target.value); setDone(null); }}>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.survey_entered_at ? "" : " (not entered)"}
              </option>
            ))}
          </select>
        </div>
        {done ? <p className={styles.status} role="status">Saved {done}&apos;s survey.</p> : null}
      </div>
      <SurveyForm
        key={current}
        person={person}
        tasks={tasks.filter((t) => t.participant_id === current)}
        answers={answers.find((a) => a.participant_id === current) ?? null}
        onSaved={afterSave}
        onClose={onClose}
      />
    </Drawer>
  );
}

type Row = SurveyTaskInput & { key: string };

function blankRow(i: number): Row {
  return { key: `new-${i}-${Math.random().toString(36).slice(2, 8)}`, title: "", hours_per_week: "", energy: "", judgment: "" };
}

function SurveyForm({
  person,
  tasks,
  answers,
  onSaved,
  onClose,
}: {
  person: ParticipantRow;
  tasks: TaskRow[];
  answers: AnswerRow | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: person.name,
    role_title: person.role_title ?? "",
    email: person.email ?? "",
    years_with_company: person.years_with_company == null ? "" : String(person.years_with_company),
    best_work: answers?.best_work ?? "",
    task_to_lose: answers?.task_to_lose ?? "",
    trust_needs: answers?.trust_needs ?? "",
  });
  const [rows, setRows] = useState<Row[]>(() => {
    const existing: Row[] = tasks.map((t) => ({
      key: t.id,
      id: t.id,
      title: t.title,
      hours_per_week: String(t.hours_per_week),
      energy: String(t.energy),
      judgment: String(t.judgment),
    }));
    return existing.length ? existing : [blankRow(0), blankRow(1), blankRow(2)];
  });
  const { pending, error, run } = useDxAction();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setRow = (key: string, k: keyof SurveyTaskInput, v: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [k]: v } : r)));

  function save() {
    const input: SurveyInput = { ...form, tasks: rows.map(({ key: _key, ...r }) => r) };
    run(() => saveSurveyAction(person.id, input), onSaved);
  }

  const rating = (r: Row, k: "energy" | "judgment", label: string) => (
    <select className={styles.cellInput} aria-label={`${label} for ${r.title || "this task"}`} value={String(r[k])} onChange={(e) => setRow(r.key, k, e.target.value)}>
      <option value="">-</option>
      {[1, 2, 3, 4, 5].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className={styles.body}>
        <p className={styles.muted}>
          Read this first: what you tell me stays with me. The owner sees combined results, never your individual ratings or answers.
        </p>
        <div className={styles.grid2}>
          {(
            [
              ["name", "Name"],
              ["role_title", "Role"],
              ["email", "Email"],
              ["years_with_company", "Years with the company"],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className={admin.field}>
              <label className={admin.label} htmlFor={`survey-${k}`}>
                {label}
              </label>
              <input
                id={`survey-${k}`}
                className={admin.input}
                value={form[k]}
                onChange={set(k)}
                inputMode={k === "years_with_company" ? "decimal" : undefined}
                type={k === "email" ? "email" : "text"}
              />
            </div>
          ))}
        </div>
      </div>
      <h3 className={styles.subhead}>
        Work that gets in the way of your best work
        <span className={styles.subheadMeta}>
          Energy: 1 drains me, 5 energizes me. Judgment: 1 fully routine, 5 needs my experience every time.
        </span>
      </h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Recurring task</th>
              <th className={styles.num}>Hours a week</th>
              <th>Energy</th>
              <th>Judgment</th>
              <th>
                <span className={styles.srOnly}>Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td>
                  <input
                    className={`${styles.cellInput} ${styles.cellWide}`}
                    aria-label={`Task ${i + 1}`}
                    value={r.title}
                    onChange={(e) => setRow(r.key, "title", e.target.value)}
                    maxLength={300}
                  />
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    aria-label={`Hours a week for task ${i + 1}`}
                    inputMode="decimal"
                    value={String(r.hours_per_week)}
                    onChange={(e) => setRow(r.key, "hours_per_week", e.target.value)}
                  />
                </td>
                <td>{rating(r, "energy", "Energy")}</td>
                <td>{rating(r, "judgment", "Judgment")}</td>
                <td>
                  <button
                    type="button"
                    className={`${styles.secondary} ${styles.small}`}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    aria-label={`Remove task ${i + 1}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.body}>
        {rows.length < MAX_TASKS_PER_PARTICIPANT ? (
          <span>
            <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setRows((rs) => [...rs, blankRow(rs.length)])}>
              Add a task
            </button>
          </span>
        ) : (
          <p className={styles.muted}>Ten tasks is the most one survey holds.</p>
        )}
        {OPEN_QUESTIONS.map((q) => (
          <div key={q.key} className={admin.field}>
            <label className={admin.label} htmlFor={`survey-${q.key}`}>
              {q.label}
            </label>
            <textarea id={`survey-${q.key}`} className={styles.textarea} value={form[q.key]} onChange={set(q.key)} maxLength={4000} />
          </div>
        ))}
        <span className={styles.formRow}>
          <button type="button" className={styles.primary} onClick={save} disabled={pending}>
            Save survey
          </button>
          <button type="button" className={styles.secondary} onClick={onClose} disabled={pending}>
            Close
          </button>
          {error ? <span className={styles.error} role="alert">{error}</span> : null}
        </span>
      </div>
    </>
  );
}
