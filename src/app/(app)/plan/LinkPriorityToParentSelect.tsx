"use client";

import { useTransition, useState } from "react";
import { setPriorityParentAction } from "@/lib/plan/actions";
import type { AnnualGoal, StrategicFocusArea } from "@/lib/types";
import { PriorityParentOptions } from "./PriorityParentOptions";
import styles from "./plan.module.css";

// The inline "link this somewhere" control on a standalone priority.
// Used from the "Standalone Quarterly Priorities" section.
//
// Since migration 0209 a priority may sit under a goal OR under a
// focus area, so this offers both in one grouped list rather than
// only goals.
export function LinkPriorityToParentSelect({
  priorityId,
  currentParent,
  goalOptions,
  sfaOptions,
}: {
  priorityId: string;
  // Wire form of the current parent ref, "" when standalone.
  currentParent: string;
  goalOptions: Pick<AnnualGoal, "id" | "title">[];
  sfaOptions: Pick<StrategicFocusArea, "id" | "title">[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextValue = event.target.value;
    startTransition(async () => {
      const result = await setPriorityParentAction(priorityId, nextValue);
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
        defaultValue={currentParent}
        onChange={onChange}
        disabled={pending}
      >
        <PriorityParentOptions
          goalOptions={goalOptions}
          sfaOptions={sfaOptions}
        />
      </select>
      {message ? (
        <span className={styles.linkMessage} role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
