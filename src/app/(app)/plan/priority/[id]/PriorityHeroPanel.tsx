"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { updatePriorityAction, type PlanResult } from "@/lib/plan/actions";
import type {
  AnnualGoal,
  CascadeStatus,
  Priority,
  Profile,
  Quarter,
} from "@/lib/types";
import { StatusPicker } from "../../StatusPicker";
import heroStyles from "@/components/plan/DetailHero.module.css";
import styles from "../../plan-detail.module.css";

// Priority hero card with an inline read/edit toggle. Mirrors SFA and
// Goal hero patterns — Edit at the bottom flips fields into inputs,
// Save closes on success.

const STATUS_LABELS: Record<CascadeStatus, string> = {
  not_started: "Not started",
  on_track: "On track",
  behind: "Behind",
  complete: "Complete",
  ongoing: "Ongoing",
};

const INITIAL: PlanResult<Priority> = { ok: false, message: "" };

export type PriorityHeroPanelProps = {
  priority: Priority;
  people: Pick<Profile, "id" | "full_name">[];
  goalOptions: Pick<AnnualGoal, "id" | "title">[];
  quarters: Array<{ id: string; label: string; status: string }>;
  goal: Pick<AnnualGoal, "id" | "title"> | null;
  quarter: Pick<Quarter, "id" | "label"> | null;
  owner: Pick<Profile, "id" | "full_name"> | null;
  progressPercent: number | null;
  isAdmin: boolean;
  isOwner: boolean;
};

export function PriorityHeroPanel({
  priority,
  people,
  goalOptions,
  quarters,
  goal,
  quarter,
  owner,
  progressPercent,
  isAdmin,
  isOwner,
}: PriorityHeroPanelProps) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<
    PlanResult<Priority>,
    FormData
  >(updatePriorityAction, INITIAL);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const saved = state && "ok" in state && state.ok;

  useEffect(() => {
    if (saved && !pending && editing) setEditing(false);
  }, [saved, pending, editing]);

  return (
    <div className={heroStyles.wrap}>
      <div className={heroStyles.band}>
        <div className={heroStyles.bandInner}>
          <Link
            href={goal ? `/plan/goal/${goal.id}` : "/plan"}
            className={heroStyles.crumb}
          >
            ← {goal ? "Back to annual goal" : "Back to plan"}
          </Link>
        </div>
      </div>

      <div className={heroStyles.card}>
        <div className={heroStyles.eyebrow}>Priority</div>

        {editing ? (
          <form action={formAction} className={styles.form}>
            <input type="hidden" name="id" value={priority.id} />

            <div className={styles.fieldWide}>
              <label htmlFor="priority-title" className={styles.label}>
                Title
              </label>
              <input
                id="priority-title"
                name="title"
                defaultValue={priority.title}
                required
                className={styles.inlineTitleInput}
                disabled={pending}
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="priority-goal" className={styles.label}>
                Annual goal
              </label>
              <select
                id="priority-goal"
                name="annual_goal_id"
                defaultValue={priority.annual_goal_id ?? ""}
                className={styles.select}
                disabled={pending}
              >
                <option value="">Not linked</option>
                {goalOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="priority-quarter" className={styles.label}>
                Quarter
              </label>
              <select
                id="priority-quarter"
                name="quarter_id"
                defaultValue={priority.quarter_id}
                className={styles.select}
                disabled={pending}
              >
                {quarters.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label} {q.status === "closed" ? "(closed)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="priority-owner" className={styles.label}>
                Owner
              </label>
              <select
                id="priority-owner"
                name="owner_id"
                defaultValue={priority.owner_id ?? ""}
                className={styles.select}
                disabled={pending}
              >
                <option value="">Unassigned</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="priority-due" className={styles.label}>
                Due date
              </label>
              <input
                id="priority-due"
                name="due_date"
                type="date"
                defaultValue={priority.due_date ?? ""}
                className={styles.input}
                disabled={pending}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="priority-status" className={styles.label}>
                Status
              </label>
              <select
                id="priority-status"
                name="status"
                defaultValue={priority.status}
                className={styles.select}
                disabled={pending}
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.fieldWide}>
              <label htmlFor="priority-description" className={styles.label}>
                Description
              </label>
              <textarea
                id="priority-description"
                name="description"
                defaultValue={priority.description ?? ""}
                rows={4}
                className={styles.textarea}
                disabled={pending}
              />
            </div>

            {errorMessage ? (
              <p role="alert" className={styles.errorMessage}>
                {errorMessage}
              </p>
            ) : null}

            <div className={styles.submitRow}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={pending}
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <h1 className={heroStyles.title}>{priority.title}</h1>
            <span className="aims-rule" aria-hidden="true" />
            <div className={heroStyles.meta}>
              {goal ? (
                <Link
                  href={`/plan/goal/${goal.id}`}
                  className={styles.rowTitle}
                >
                  Goal: {goal.title}
                </Link>
              ) : (
                <span>Not linked to a goal</span>
              )}
              <span>·</span>
              <span>Quarter: {quarter?.label ?? "—"}</span>
              <span>·</span>
              <span>Owner: {owner?.full_name ?? "Unassigned"}</span>
              {priority.due_date ? (
                <>
                  <span>·</span>
                  <span>Due {priority.due_date}</span>
                </>
              ) : null}
              <span>·</span>
              <StatusChip status={priority.status} />
              <span>·</span>
              <ProgressBar
                percent={progressPercent}
                label="No commitments yet"
              />
            </div>
            <div className={heroStyles.body}>
              {priority.description ? (
                <p className={styles.bodyText}>{priority.description}</p>
              ) : null}

              {isOwner && !isAdmin ? (
                <StatusPicker
                  level="priority"
                  id={priority.id}
                  current={priority.status}
                />
              ) : null}

              {isAdmin ? (
                <div className={styles.editTrigger}>
                  <button
                    type="button"
                    className={styles.editLink}
                    onClick={() => setEditing(true)}
                  >
                    Edit priority
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
