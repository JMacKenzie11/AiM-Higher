"use client";

import { useActionState, useState } from "react";
import {
  rollQuarterAction,
  updateQuarterAction,
  type QuarterResult,
  type RollResult,
} from "@/lib/quarters/actions";
import styles from "../admin.module.css";

// Rolling the quarter, on the company's settings page.
//
// It used to live only at /quarters, which is in no navigation menu
// anywhere: the only ways in were links that appear when something
// has already gone wrong — the dashboard's "no open quarter" eyebrow,
// the commitments empty state, an empty-goal message. The one screen
// you would visit to keep the planning cycle healthy was reachable
// mainly by breaking it first.
//
// It sits above Planning cycle deliberately. The two read as
// alternatives otherwise, and they are not: this is the routine
// quarterly act, and Planning cycle is the annual one that clears
// focus areas and goals as well.

export function QuarterCard({
  companyId,
  openQuarter,
  suggestion,
  carryCount,
}: {
  companyId: string;
  // null when the company has no open quarter. Rolling then simply
  // opens one, which the action handles without special-casing.
  openQuarter: {
    id: string;
    label: string;
    start_date: string;
    end_date: string;
  } | null;
  suggestion: { label: string; startDate: string; endDate: string };
  // How many priorities would move. Shown rather than described,
  // because "3 priorities will carry forward" is the thing somebody
  // wants to know before pressing a button that closes a quarter.
  carryCount: number;
}) {
  const [state, formAction, pending] = useActionState<
    RollResult | undefined,
    FormData
  >(rollQuarterAction, undefined);
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editPending] = useActionState<
    QuarterResult | undefined,
    FormData
  >(updateQuarterAction, undefined);

  return (
    <section className={styles.card} aria-labelledby="quarter-card">
      <h2 id="quarter-card" className={styles.h2}>
        Quarter
      </h2>

      {openQuarter ? (
        editing ? (
          <form action={editAction} className={styles.quarterRollForm}>
            <input type="hidden" name="company_id" value={companyId} />
            <input type="hidden" name="quarter_id" value={openQuarter.id} />
            <label className={styles.field}>
              <span className={styles.label}>Label</span>
              <input
                className={styles.input}
                name="label"
                defaultValue={openQuarter.label}
                required
                disabled={editPending}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Starts</span>
              <input
                className={styles.input}
                type="date"
                name="start_date"
                defaultValue={openQuarter.start_date}
                required
                disabled={editPending}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Ends</span>
              <input
                className={styles.input}
                type="date"
                name="end_date"
                defaultValue={openQuarter.end_date}
                required
                disabled={editPending}
              />
            </label>
            <button
              type="submit"
              className={styles.ghostButton}
              disabled={editPending}
            >
              {editPending ? "Saving…" : "Save dates"}
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setEditing(false)}
              disabled={editPending}
            >
              Cancel
            </button>
          </form>
        ) : (
          <p className={styles.subtitleInline}>
            Open now: <strong>{openQuarter.label}</strong>,{" "}
            {openQuarter.start_date} to {openQuarter.end_date}.{" "}
            <button
              type="button"
              className={styles.inlineEditButton}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>{" "}
            A quarter holds the company&rsquo;s priorities for the current
            90-day period.
          </p>
        )
      ) : (
        <p className={styles.subtitleInline}>
          No quarter is open. Priorities need one to live in; nothing else
          depends on it.
        </p>
      )}

      {editState && !editState.ok ? (
        <p className={styles.errorMessage}>{editState.message}</p>
      ) : null}

      <p className={styles.subtitleInline}>
        When you run your next quarterly planning session, roll the quarter:
        rolling closes this quarter, opens the next one, and moves every
        priority that is not complete into it.{" "}
        {carryCount > 0 ? (
          <>
            <strong>{carryCount}</strong>{" "}
            {carryCount === 1 ? "priority" : "priorities"} would move today.{" "}
          </>
        ) : null}
        Completed priorities stay where they were finished, so the closed
        quarter remains a record of how the team performed.
      </p>

      <form action={formAction} className={styles.quarterRollForm}>
        <input type="hidden" name="company_id" value={companyId} />
        <label className={styles.field}>
          <span className={styles.label}>Label</span>
          <input
            className={styles.input}
            name="label"
            defaultValue={suggestion.label}
            required
            disabled={pending}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Starts</span>
          <input
            className={styles.input}
            type="date"
            name="start_date"
            defaultValue={suggestion.startDate}
            required
            disabled={pending}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Ends</span>
          <input
            className={styles.input}
            type="date"
            name="end_date"
            defaultValue={suggestion.endDate}
            required
            disabled={pending}
          />
        </label>
        <button
          type="submit"
          className={styles.ghostButton}
          disabled={pending}
        >
          {pending
            ? "Rolling…"
            : openQuarter
              ? "Roll the quarter"
              : "Open a quarter"}
        </button>
      </form>

      {state ? (
        <p className={state.ok ? styles.successMessage : styles.errorMessage}>
          {state.ok
            ? `${state.quarter.label} is open.` +
              (state.moved > 0
                ? ` ${state.moved} priorit${state.moved === 1 ? "y" : "ies"} carried forward.`
                : " Nothing needed to carry forward.")
            : state.message}
        </p>
      ) : null}
    </section>
  );
}
