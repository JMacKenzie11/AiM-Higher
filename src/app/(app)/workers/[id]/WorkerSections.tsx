"use client";

import { useActionState, useState, useTransition } from "react";
import {
  deleteMemoryAction,
  deletePasswordAction,
  deleteRuleAction,
  deleteSkillAction,
  saveMemoryAction,
  savePasswordAction,
  saveSkillAction,
  setAllowPressesAction,
  type WorkerFormState,
} from "@/lib/workers/actions";
import type { WorkerMemory, WorkerRule, WorkerSecret, WorkerSkill } from "@/lib/workers/types";
import styles from "../workers.module.css";

function Feedback({ state }: { state: WorkerFormState }) {
  if (!state) return null;
  return state.ok ? (
    state.message ? <p className={styles.saved} role="status">{state.message}</p> : null
  ) : (
    <p className={styles.error} role="alert">{state.message}</p>
  );
}

// ---- Permissions ----------------------------------------------------

export function PermissionsSection({ workerId, allowPresses, rules }: { workerId: string; allowPresses: boolean; rules: WorkerRule[] }) {
  const [pending, start] = useTransition();
  return (
    <div className={styles.body}>
      <p className={styles.hint}>
        Choose what this worker may do without asking you. Reading pages, searching and signing in never ask. When it wants to save,
        send or submit something on a website, it asks first unless you allow it here.
      </p>
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          defaultChecked={allowPresses}
          disabled={pending}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            start(() => setAllowPressesAction(workerId, on));
          }}
        />
        <span>
          <span className={styles.label}>Edit records in websites</span>
          <br />
          <span className={styles.hint}>Fill in forms and press buttons that save, send or submit, on any website it uses, without asking.</span>
        </span>
      </label>
      <div className={styles.field}>
        <span className={styles.label}>Allowed always</span>
        {rules.length === 0 ? (
          <p className={styles.hint}>None yet. When you choose Allow always on an approval, the website shows here.</p>
        ) : (
          <ul className={styles.list}>
            {rules.map((r) => (
              <li key={r.id} className={styles.row}>
                <div className={styles.rowMain}>Save, send and submit on {r.domain} without asking</div>
                <button type="button" className={styles.linkButton} disabled={pending} onClick={() => start(() => deleteRuleAction(workerId, r.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className={styles.hint}>Payments, deletes, posts to the public, access changes and terms always ask you.</p>
    </div>
  );
}

// ---- Passwords ------------------------------------------------------

export function PasswordsSection({ workerId, secrets }: { workerId: string; secrets: WorkerSecret[] }) {
  const [state, formAction, saving] = useActionState<WorkerFormState, FormData>(savePasswordAction.bind(null, workerId), null);
  const [pending, start] = useTransition();
  return (
    <div className={styles.body}>
      <p className={styles.hint}>
        Passwords this worker can type into websites. It never sees them, and nobody can read them back here. When it needs one it
        doesn&apos;t have, it asks you.
      </p>
      {secrets.length === 0 ? (
        <p className={styles.hint}>No saved passwords.</p>
      ) : (
        <ul className={styles.list}>
          {secrets.map((s) => (
            <li key={s.id} className={styles.row}>
              <div className={styles.rowMain}>{s.label}</div>
              <button type="button" className={styles.linkButton} disabled={pending} onClick={() => start(() => deletePasswordAction(workerId, s.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form action={formAction} className={styles.inline}>
        <input name="label" className={styles.input} placeholder="What it's for, like holabirdsports.com" aria-label="What the password is for" maxLength={120} autoComplete="off" />
        <input name="value" type="password" className={styles.input} placeholder="Password" aria-label="Password" autoComplete="new-password" />
        <button type="submit" className={styles.secondary} disabled={saving}>
          {saving ? "Saving…" : "Save password"}
        </button>
      </form>
      <Feedback state={state} />
    </div>
  );
}

// ---- Memory ---------------------------------------------------------

function MemoryForm({ workerId, memory, onDone }: { workerId: string; memory: WorkerMemory | null; onDone?: () => void }) {
  const [state, formAction, saving] = useActionState<WorkerFormState, FormData>(async (prev, form) => {
    const r = await saveMemoryAction(workerId, memory?.id ?? null, prev, form);
    if (r?.ok) onDone?.();
    return r;
  }, null);
  return (
    <form action={formAction} className={styles.body} key={memory?.id ?? "new"}>
      <label className={styles.field}>
        <span className={styles.label}>Title</span>
        <input name="title" className={styles.input} defaultValue={memory?.title ?? ""} placeholder="For example: Vendor payment terms" maxLength={200} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>What to remember</span>
        <textarea name="body" className={styles.textarea} defaultValue={memory?.body ?? ""} maxLength={8000} />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.secondary} disabled={saving}>
          {saving ? "Saving…" : "Save memory"}
        </button>
        {onDone ? (
          <button type="button" className={styles.linkButton} onClick={onDone}>
            Cancel
          </button>
        ) : null}
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function MemorySection({ workerId, memories }: { workerId: string; memories: WorkerMemory[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div>
      <p className={`${styles.hint} ${styles.body}`}>What the worker remembers between tasks. It reads these notes on every task.</p>
      {memories.length > 0 ? (
        <ul className={styles.list}>
          {memories.map((m) =>
            editing === m.id ? (
              <li key={m.id}>
                <MemoryForm workerId={workerId} memory={m} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={m.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.feedHead}><strong>{m.title}</strong></p>
                  <p className={styles.feedDetail}>{m.body}</p>
                </div>
                <button type="button" className={styles.linkButton} onClick={() => setEditing(m.id)}>
                  Edit
                </button>
                <button type="button" className={styles.linkButton} disabled={pending} onClick={() => start(() => deleteMemoryAction(workerId, m.id))}>
                  Remove
                </button>
              </li>
            )
          )}
        </ul>
      ) : null}
      {adding ? (
        <MemoryForm workerId={workerId} memory={null} onDone={() => setAdding(false)} />
      ) : (
        <div className={styles.body}>
          <div>
            <button type="button" className={styles.secondary} onClick={() => setAdding(true)}>
              Add a memory
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Skills ---------------------------------------------------------

export type SkillStats = { taughtFrom: { steps: number; cents: number } | null; since: { tasks: number; avgSteps: number; avgCents: number } };

function SkillForm({ workerId, skill, onDone }: { workerId: string; skill: WorkerSkill; onDone: () => void }) {
  const [state, formAction, saving] = useActionState<WorkerFormState, FormData>(async (prev, form) => {
    const r = await saveSkillAction(workerId, skill.id, prev, form);
    if (r?.ok) onDone();
    return r;
  }, null);
  return (
    <form action={formAction} className={styles.body}>
      <label className={styles.field}>
        <span className={styles.label}>Title</span>
        <input name="title" className={styles.input} defaultValue={skill.title} maxLength={200} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Steps</span>
        <textarea name="body" className={`${styles.textarea} ${styles.skillBody}`} defaultValue={skill.body} maxLength={16000} />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.secondary} disabled={saving}>
          {saving ? "Saving…" : "Save skill"}
        </button>
        <button type="button" className={styles.linkButton} onClick={onDone}>
          Cancel
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

function money(cents: number) {
  return cents < 1 ? "under 1¢" : `$${(cents / 100).toFixed(2)}`;
}

export function SkillsSection({ workerId, skills, stats }: { workerId: string; skills: WorkerSkill[]; stats: Record<string, SkillStats> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (skills.length === 0) {
    return (
      <p className={styles.empty}>
        No skills yet. When a task goes well, open it and press <strong>Teach this task</strong>. The worker follows the steps next time.
      </p>
    );
  }
  return (
    <ul className={styles.list}>
      {skills.map((k) => {
        const st = stats[k.id];
        return editing === k.id ? (
          <li key={k.id}>
            <SkillForm workerId={workerId} skill={k} onDone={() => setEditing(null)} />
          </li>
        ) : (
          <li key={k.id} className={styles.row}>
            <div className={styles.rowMain}>
              <p className={styles.feedHead}><strong>{k.title}</strong></p>
              <p className={styles.result}>{k.body}</p>
              {st ? (
                <p className={styles.rowMeta}>
                  {st.taughtFrom ? `Taught from a task that took ${st.taughtFrom.steps} steps and cost ${money(st.taughtFrom.cents)}. ` : ""}
                  {st.since.tasks > 0
                    ? `Finished since: ${st.since.tasks}, averaging ${st.since.avgSteps} steps and ${money(st.since.avgCents)}.`
                    : "No finished tasks since it was taught."}
                </p>
              ) : null}
            </div>
            <button type="button" className={styles.linkButton} onClick={() => setEditing(k.id)}>
              Edit
            </button>
            <button type="button" className={styles.linkButton} disabled={pending} onClick={() => start(() => deleteSkillAction(workerId, k.id))}>
              Remove
            </button>
          </li>
        );
      })}
    </ul>
  );
}
