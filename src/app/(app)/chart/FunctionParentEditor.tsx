"use client";

import { useState, useTransition } from "react";
import { setFunctionParentAction } from "@/lib/chart/actions";
import styles from "./chart.module.css";

// Where a function sits on the chart, changeable.
//
// It was a read-only "Part of Field Operations" line, which was
// fine while the parent could only be chosen at creation: get it
// wrong and the only remedy was to delete the function and add it
// again, taking its responsibilities with it.
//
// A non-admin still gets the line, and it still jumps: they have
// nothing to change and a disabled select is a worse way to say so.
//
// The options exclude this function and everything under it. That is
// computed on the server, where the whole tree is; the refusal in
// setFunctionParentAction is the boundary, and this list is what
// stops anybody meeting it.
export function FunctionParentEditor({
  functionId,
  parent,
  options,
  canEdit,
  onSwitch,
  onChanged,
}: {
  functionId: string;
  parent: { id: string; title: string } | null;
  options: Array<{ id: string; title: string }>;
  canEdit: boolean;
  onSwitch: (id: string) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function commit(next: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await setFunctionParentAction(functionId, next);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setEditing(false);
      onChanged();
    });
  }

  if (!canEdit) {
    return parent ? (
      <p className={styles.fnDrawerParent}>
        Part of{" "}
        <button
          type="button"
          className={styles.fnDrawerJump}
          onClick={() => onSwitch(parent.id)}
        >
          {parent.title}
        </button>
      </p>
    ) : null;
  }

  if (editing) {
    return (
      <div className={styles.fnDrawerParent}>
        <select
          className={styles.seatSelect}
          defaultValue={parent?.id ?? ""}
          onChange={(e) => commit(e.target.value || null)}
          disabled={pending}
          autoFocus
          aria-label="Sits under"
        >
          <option value="">Top level (no parent)</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.roleGhostButton}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
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
    <p className={styles.fnDrawerParent}>
      {parent ? (
        <>
          Part of{" "}
          <button
            type="button"
            className={styles.fnDrawerJump}
            onClick={() => onSwitch(parent.id)}
          >
            {parent.title}
          </button>{" "}
        </>
      ) : (
        <>Top level. </>
      )}
      <button
        type="button"
        className={styles.seatEditHint}
        onClick={() => setEditing(true)}
        aria-label="Change where this function sits"
      >
        Move
      </button>
    </p>
  );
}
