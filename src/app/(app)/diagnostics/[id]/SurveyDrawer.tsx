"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { saveSurveyAction, saveSystemAction, type AiUseInput, type SurveyInput, type SurveyTaskInput } from "@/lib/diagnostics/actions";
import { MAX_TASKS_PER_PARTICIPANT } from "@/lib/diagnostics/hours-back";
import { AI_FREQUENCIES, SYSTEM_KINDS, type AiUseRow, type AnswerRow, type ParticipantRow, type SystemRow, type TaskRow } from "@/lib/diagnostics/types";
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

type Props = { participants: ParticipantRow[]; tasks: TaskRow[]; answers: AnswerRow[]; systems: SystemRow[]; aiUse: AiUseRow[] };

// The AI section's questions (phase 4), in the brief's order.
export const AI_QUESTIONS = {
  intro: "There are no right or wrong answers, and nobody's individual answer is shared.",
  tools: "Which AI tools, if any, do you use for work?",
  provided: "Did the company provide it, or did you find it yourself?",
  usedFor: "What do you use it for?",
  frequency: "How often?",
  neverShare: "What would you never put into one?",
} as const;

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

function SurveyDrawer({ participants, tasks, answers, systems, aiUse, startWith, onClose }: Props & { startWith: string; onClose: () => void }) {
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
        systems={systems}
        aiUse={aiUse.filter((u) => u.participant_id === current)}
        onSaved={afterSave}
        onClose={onClose}
      />
    </Drawer>
  );
}

type Row = SurveyTaskInput & { key: string; copies: boolean };
type AiRow = AiUseInput & { key: string };

const newKey = (i: number) => `new-${i}-${Math.random().toString(36).slice(2, 8)}`;

function blankRow(i: number): Row {
  return { key: newKey(i), title: "", hours_per_week: "", energy: "", judgment: "", system_id: "", copies: false, copies_from_system_id: "", copies_to_system_id: "" };
}

function blankTool(i: number): AiRow {
  return { key: newKey(i), tool: "", provided_by: "", used_for: "", frequency: "", never_share: "" };
}

// A system picker's "Add a system" choice, for one the walkthrough
// missed.
const ADD = "__add";
type SystemField = "system_id" | "copies_from_system_id" | "copies_to_system_id";

function SurveyForm({
  person,
  tasks,
  answers,
  systems: initialSystems,
  aiUse,
  onSaved,
  onClose,
}: {
  person: ParticipantRow;
  tasks: TaskRow[];
  answers: AnswerRow | null;
  systems: SystemRow[];
  aiUse: AiUseRow[];
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
      system_id: t.system_id ?? "",
      copies: Boolean(t.copies_from_system_id),
      copies_from_system_id: t.copies_from_system_id ?? "",
      copies_to_system_id: t.copies_to_system_id ?? "",
    }));
    return existing.length ? existing : [blankRow(0), blankRow(1), blankRow(2)];
  });
  const [systems, setSystems] = useState(initialSystems);
  const [adding, setAdding] = useState<{ row: string; field: SystemField } | null>(null);
  const [newSystem, setNewSystem] = useState({ name: "", kind: "other" });
  const addSystem = useDxAction();
  const [noAi, setNoAi] = useState(person.uses_no_ai);
  const [tools, setTools] = useState<AiRow[]>(() =>
    aiUse.length
      ? aiUse.map((u) => ({
          key: u.id,
          id: u.id,
          tool: u.tool,
          provided_by: u.provided_by ?? "",
          used_for: u.used_for ?? "",
          frequency: u.frequency ?? "",
          never_share: u.never_share ?? "",
        }))
      : [blankTool(0)]
  );
  const setTool = (key: string, k: keyof AiUseInput, v: string) => setTools((ts) => ts.map((t) => (t.key === key ? { ...t, [k]: v } : t)));
  const { pending, error, run } = useDxAction();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setRow = (key: string, k: keyof Row, v: string | boolean) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [k]: v } : r)));

  function save() {
    const input: SurveyInput = {
      ...form,
      tasks: rows.map(({ key: _key, copies, ...r }) => ({
        ...r,
        copies_from_system_id: copies ? r.copies_from_system_id : "",
        copies_to_system_id: copies ? r.copies_to_system_id : "",
      })),
      uses_no_ai: noAi,
      ai: noAi ? [] : tools.map(({ key: _key, ...t }) => t),
    };
    run(() => saveSurveyAction(person.id, input), onSaved);
  }

  function pickSystem(r: Row, field: SystemField, v: string) {
    if (v === ADD) {
      setNewSystem({ name: "", kind: "other" });
      setAdding({ row: r.key, field });
      return;
    }
    setRow(r.key, field, v);
  }

  function saveNewSystem() {
    const target = adding;
    if (!target) return;
    addSystem.run(
      () => saveSystemAction(person.diagnostic_id, null, newSystem),
      (res) => {
        if (!res.id) return;
        setSystems((ss) => [...ss, { id: res.id!, diagnostic_id: person.diagnostic_id, name: newSystem.name.trim(), kind: newSystem.kind as SystemRow["kind"], holds: null, owner_name: null, notes: null, created_at: "" }]);
        setRow(target.row, target.field, res.id!);
        setAdding(null);
      }
    );
  }

  const systemPicker = (r: Row, field: SystemField, label: string, i: number) => (
    <label className={styles.inlineField}>
      <span>{label}</span>
      <select className={styles.cellInput} aria-label={`${label} for task ${i + 1}`} value={String(r[field] ?? "")} onChange={(e) => pickSystem(r, field, e.target.value)}>
        <option value="">{field === "system_id" ? "Not said" : "Choose"}</option>
        {systems.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        <option value={ADD}>Add a system</option>
      </select>
    </label>
  );

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
            {rows.map((r, i) => [
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
              </tr>,
              <tr key={`${r.key}-systems`} className={styles.subRow}>
                <td colSpan={5}>
                  <span className={styles.formRow}>
                    {systemPicker(r, "system_id", "Where does this happen?", i)}
                    <label className={styles.inlineField}>
                      <span>Does this mean copying information from one system to another?</span>
                      <select
                        className={styles.cellInput}
                        aria-label={`Copies between systems for task ${i + 1}`}
                        value={r.copies ? "yes" : "no"}
                        onChange={(e) => setRow(r.key, "copies", e.target.value === "yes")}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </select>
                    </label>
                    {r.copies ? (
                      <>
                        {systemPicker(r, "copies_from_system_id", "From", i)}
                        {systemPicker(r, "copies_to_system_id", "To", i)}
                      </>
                    ) : null}
                  </span>
                </td>
              </tr>,
            ])}
          </tbody>
        </table>
      </div>
      {adding ? (
        <div className={styles.runner} aria-label="Add a system">
          <span className={styles.formRow}>
            <input
              className={admin.input}
              aria-label="New system name"
              placeholder="System name"
              value={newSystem.name}
              onChange={(e) => setNewSystem((n) => ({ ...n, name: e.target.value }))}
              maxLength={200}
              autoFocus
            />
            <select className={admin.select} aria-label="New system kind" value={newSystem.kind} onChange={(e) => setNewSystem((n) => ({ ...n, kind: e.target.value }))}>
              {SYSTEM_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <button type="button" className={`${styles.primary} ${styles.small}`} onClick={saveNewSystem} disabled={addSystem.pending}>
              Add the system
            </button>
            <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setAdding(null)} disabled={addSystem.pending}>
              Cancel
            </button>
            {addSystem.error ? <span className={styles.error} role="alert">{addSystem.error}</span> : null}
          </span>
        </div>
      ) : null}
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
      </div>
      <h3 className={styles.subhead}>
        AI at work
        <span className={styles.subheadMeta}>{AI_QUESTIONS.intro}</span>
      </h3>
      <div className={styles.body}>
        <span className={admin.label}>{AI_QUESTIONS.tools}</span>
        <label className={styles.check}>
          <input type="checkbox" checked={noAi} onChange={(e) => setNoAi(e.target.checked)} />
          None
        </label>
        {noAi
          ? null
          : tools.map((t, i) => (
              <fieldset key={t.key} className={styles.toolRow}>
                <legend className={styles.srOnly}>AI tool {i + 1}</legend>
                <div className={styles.grid2}>
                  <div className={admin.field}>
                    <label className={admin.label} htmlFor={`ai-tool-${t.key}`}>
                      Tool {i + 1}
                    </label>
                    <input id={`ai-tool-${t.key}`} className={admin.input} value={t.tool} onChange={(e) => setTool(t.key, "tool", e.target.value)} maxLength={200} />
                  </div>
                  <div className={admin.field}>
                    <label className={admin.label} htmlFor={`ai-provided-${t.key}`}>
                      {AI_QUESTIONS.provided}
                    </label>
                    <select id={`ai-provided-${t.key}`} className={admin.select} value={t.provided_by} onChange={(e) => setTool(t.key, "provided_by", e.target.value)}>
                      <option value="">Not said</option>
                      <option value="company">The company provided it</option>
                      <option value="personal">Found it myself</option>
                    </select>
                  </div>
                  <div className={admin.field}>
                    <label className={admin.label} htmlFor={`ai-for-${t.key}`}>
                      {AI_QUESTIONS.usedFor}
                    </label>
                    <input id={`ai-for-${t.key}`} className={admin.input} value={t.used_for} onChange={(e) => setTool(t.key, "used_for", e.target.value)} maxLength={2000} />
                  </div>
                  <div className={admin.field}>
                    <label className={admin.label} htmlFor={`ai-often-${t.key}`}>
                      {AI_QUESTIONS.frequency}
                    </label>
                    <select id={`ai-often-${t.key}`} className={admin.select} value={t.frequency} onChange={(e) => setTool(t.key, "frequency", e.target.value)}>
                      <option value="">Not said</option>
                      {AI_FREQUENCIES.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={admin.field}>
                  <label className={admin.label} htmlFor={`ai-never-${t.key}`}>
                    {AI_QUESTIONS.neverShare}
                  </label>
                  <input id={`ai-never-${t.key}`} className={admin.input} value={t.never_share} onChange={(e) => setTool(t.key, "never_share", e.target.value)} maxLength={2000} />
                </div>
                <span>
                  <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setTools((ts) => ts.filter((x) => x.key !== t.key))}>
                    Remove tool {i + 1}
                  </button>
                </span>
              </fieldset>
            ))}
        {noAi ? null : (
          <span>
            <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setTools((ts) => [...ts, blankTool(ts.length)])}>
              Add a tool
            </button>
          </span>
        )}
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
