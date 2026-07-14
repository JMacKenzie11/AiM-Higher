"use client";

import { useState, useTransition } from "react";
import {
  updateGoalStatusAction,
  updatePriorityStatusAction,
  updateSfaStatusAction,
} from "@/lib/plan/actions";
import type { CascadeStatus } from "@/lib/types";
import styles from "./plan-detail.module.css";

// Owner-only status picker. Used on the SFA/Goal/Priority detail
// pages when the caller is the item's owner (or sponsor for an SFA)
// but is NOT an admin. Admins get the full edit form instead.

const STATUSES: { value: CascadeStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "on_track", label: "On track" },
  { value: "behind", label: "Behind" },
  { value: "complete", label: "Complete" },
  { value: "ongoing", label: "Ongoing" },
];

type Level = "sfa" | "goal" | "priority";

export function StatusPicker({
  level,
  id,
  current,
}: {
  level: Level;
  id: string;
  current: CascadeStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as CascadeStatus;
    startTransition(async () => {
      const fn =
        level === "sfa"
          ? updateSfaStatusAction
          : level === "goal"
            ? updateGoalStatusAction
            : updatePriorityStatusAction;
      const result = await fn(id, next);
      setMessage(result.ok ? "Status updated." : result.message);
    });
  }

  return (
    <div className={styles.statusPicker}>
      <label htmlFor={`status-${id}`} className={styles.label}>
        Update status
      </label>
      <select
        id={`status-${id}`}
        className={styles.select}
        defaultValue={current}
        onChange={onChange}
        disabled={pending}
      >
        {STATUSES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {message ? (
        <span className={styles.pickerMessage} role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
