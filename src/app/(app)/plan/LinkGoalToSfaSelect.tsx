"use client";

import { useTransition, useState } from "react";
import { setGoalSfaAction } from "@/lib/plan/actions";
import type { StrategicFocusArea } from "@/lib/types";
import styles from "./plan.module.css";

// Small controlled dropdown that fires setGoalSfaAction on change.
// Used from the "Goals without a focus area" section.

export function LinkGoalToSfaSelect({
  goalId,
  currentSfaId,
  options,
}: {
  goalId: string;
  currentSfaId: string | null;
  options: Pick<StrategicFocusArea, "id" | "title">[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextValue = event.target.value === "" ? null : event.target.value;
    startTransition(async () => {
      const result = await setGoalSfaAction(goalId, nextValue);
      setMessage(
        result.ok ? "Linked." : result.message ?? "Couldn't link that goal."
      );
    });
  }

  return (
    <div className={styles.linkSelect}>
      <label className={styles.label} htmlFor={`link-${goalId}`}>
        Link to
      </label>
      <select
        id={`link-${goalId}`}
        className={styles.select}
        defaultValue={currentSfaId ?? ""}
        onChange={onChange}
        disabled={pending}
      >
        <option value="">Focus area…</option>
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
