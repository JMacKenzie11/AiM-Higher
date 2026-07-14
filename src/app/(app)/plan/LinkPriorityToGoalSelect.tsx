"use client";

import { useTransition, useState } from "react";
import { setPriorityGoalAction } from "@/lib/plan/actions";
import type { AnnualGoal } from "@/lib/types";
import styles from "./plan.module.css";

export function LinkPriorityToGoalSelect({
  priorityId,
  currentGoalId,
  options,
}: {
  priorityId: string;
  currentGoalId: string | null;
  options: Pick<AnnualGoal, "id" | "title">[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextValue = event.target.value === "" ? null : event.target.value;
    startTransition(async () => {
      const result = await setPriorityGoalAction(priorityId, nextValue);
      setMessage(
        result.ok ? "Linked." : result.message ?? "Couldn't link that priority."
      );
    });
  }

  return (
    <div className={styles.linkSelect}>
      <label className={styles.label} htmlFor={`link-${priorityId}`}>
        Link to
      </label>
      <select
        id={`link-${priorityId}`}
        className={styles.select}
        defaultValue={currentGoalId ?? ""}
        onChange={onChange}
        disabled={pending}
      >
        <option value="">Annual goal…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.title}
          </option>
        ))}
      </select>
      {message ? (
        <span className={styles.linkMessage} role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
