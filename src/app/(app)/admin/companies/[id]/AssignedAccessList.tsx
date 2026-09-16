"use client";

import { useState, useTransition } from "react";
import {
  removeGuideFromCompanyAction,
} from "@/lib/admin/assigned-access-actions";
import type { AssignedAccessRow } from "@/lib/admin/assigned-access";
import styles from "../admin.module.css";

// The "Assigned access" card's table. Spec §1a, decision 9.
//
// Two kinds of row, and the difference between them is the point of
// the Type column rather than decoration:
//
//   AiMS Guide  an engagement the company may end (decision 7)
//   Portfolio   the operating partner, whom it may not (decision 5)
//
// So only guide rows carry Remove, and the footnote says why the
// others do not. A row with no control and no explanation is the
// failure this card was reshaped to avoid: the control that is there
// and does nothing, or the absence that reads as a bug.

export function AssignedAccessList({
  companyId,
  people,
  canRemove,
}: {
  companyId: string;
  people: AssignedAccessRow[];
  canRemove: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // Per-row rather than a single flag. One shared `pending` disables
  // every control on the table while any one of them is working,
  // which reads as the page freezing.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (people.length === 0) {
    return (
      <p className={styles.emptyLine}>
        Nobody outside this company has access to it.
      </p>
    );
  }

  const hasPortfolio = people.some((p) => p.kind === "portfolio");

  function remove(guideId: string, name: string) {
    if (
      !window.confirm(
        `Remove ${name} from this company? They keep their account and any other companies they work with.`
      )
    ) {
      return;
    }
    setError(null);
    setBusyId(guideId);
    startTransition(async () => {
      const result = await removeGuideFromCompanyAction(companyId, guideId);
      setBusyId(null);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <>
      {error ? <p className={styles.errorMessage}>{error}</p> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Type</th>
            {canRemove ? <th className={styles.actionHead}>Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={`${person.kind}-${person.profileId}`}>
              <td>{person.fullName}</td>
              <td className={person.email ? undefined : styles.mutedCell}>
                {person.email ?? "no sign-in on file"}
              </td>
              <td>
                <span className={styles.chipInfo}>
                  {person.kind === "guide" ? "AiMS Guide" : "Portfolio"}
                </span>
              </td>
              {canRemove ? (
                <td>
                  {person.kind === "guide" ? (
                    <button
                      type="button"
                      className={styles.dangerGhost}
                      disabled={pending && busyId === person.profileId}
                      onClick={() => remove(person.profileId, person.fullName)}
                    >
                      {pending && busyId === person.profileId
                        ? "Removing..."
                        : "Remove from this company"}
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {hasPortfolio ? (
        <p className={styles.rowFootnote}>
          Portfolio access is managed at the portfolio level and cannot be
          removed here.
        </p>
      ) : null}
    </>
  );
}
