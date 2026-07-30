"use client";

import { useState, useTransition } from "react";
import { setFunctionRoleAction } from "@/lib/chart/actions";
import type { Profile } from "@/lib/types";
import styles from "../../chart.module.css";

// Click the seat holder line to reassign. Dropdown lists everyone
// active in the company; an "Unassigned" option clears the seat.
// setFunctionRoleAction with role='lead' writes the seat holder;
// track/decide default to lead in the UI when unset.

export function SeatEditor({
  functionId,
  currentSeatHolder,
  roster,
  canEdit,
}: {
  functionId: string;
  currentSeatHolder: Pick<Profile, "id" | "full_name"> | null;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(personId: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await setFunctionRoleAction(functionId, "lead", personId);
      if (!result.ok) {
        setError(result.message);
      } else {
        setEditing(false);
      }
    });
  }

  if (!canEdit) {
    return (
      <span
        className={
          currentSeatHolder
            ? styles.fnSeatName
            : `${styles.fnSeatName} ${styles.fnSeatEmpty}`
        }
      >
        {currentSeatHolder?.full_name ?? "Unassigned"}
      </span>
    );
  }

  if (editing) {
    return (
      <div className={styles.seatEditor}>
        <select
          className={styles.seatSelect}
          defaultValue={currentSeatHolder?.id ?? ""}
          onChange={(e) => handleChange(e.target.value || null)}
          disabled={pending}
          autoFocus
        >
          <option value="">Unassigned</option>
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.roleGhostButton}
          onClick={() => setEditing(false)}
          disabled={pending}
        >
          Cancel
        </button>
        {error ? (
          <p role="alert" className={styles.roleError}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={styles.seatButton}
      onClick={() => setEditing(true)}
      aria-label="Change who's in the seat"
    >
      <span
        className={
          currentSeatHolder
            ? styles.fnSeatName
            : `${styles.fnSeatName} ${styles.fnSeatEmpty}`
        }
      >
        {currentSeatHolder?.full_name ?? "Unassigned"}
      </span>
      <span className={styles.seatEditHint}>Change</span>
    </button>
  );
}
