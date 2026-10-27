"use client";

import { useState, useTransition } from "react";
import { teachSkillAction, type WorkerFormState } from "@/lib/workers/actions";
import styles from "../../../workers.module.css";

// Teach a task (step 3): writes this finished task up as a skill and
// opens the worker's skills to read it.
export function TeachButton({ workerId, runId }: { workerId: string; runId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<WorkerFormState>(null);
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.secondary} disabled={pending} onClick={() => start(async () => setState(await teachSkillAction(workerId, runId)))}>
        {pending ? "Writing it up…" : "Teach this task"}
      </button>
      <p className={styles.hint}>Turns what it did into steps it follows next time.</p>
      {state && !state.ok ? <p className={styles.error} role="alert">{state.message}</p> : null}
    </div>
  );
}
