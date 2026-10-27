"use client";

import { useActionState } from "react";
import { startRunAction, type WorkerFormState } from "@/lib/workers/actions";
import { TASK_MAX } from "@/lib/workers/types";
import styles from "../workers.module.css";

export function TaskForm({ workerId, busy }: { workerId: string; busy: boolean }) {
  const [state, formAction, pending] = useActionState<WorkerFormState, FormData>(startRunAction.bind(null, workerId), null);
  return (
    <form action={formAction} className={styles.body}>
      <label className={styles.field}>
        <span className={styles.label}>What should it do?</span>
        <textarea
          name="task"
          className={styles.textarea}
          maxLength={TASK_MAX}
          required
          placeholder="For example: Search holabirdsports.com for running shoes and give me the name, price and rating of the first 3 results."
        />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending || busy}>
          {pending ? "Starting…" : "Start"}
        </button>
        {busy ? <p className={styles.hint}>It&apos;s on a task now, or waiting on you. You can give it another when that one finishes.</p> : null}
        {state && !state.ok ? <p className={styles.error} role="alert">{state.message}</p> : null}
      </div>
    </form>
  );
}
