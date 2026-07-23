"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import {
  archiveGoalAction,
  completeGoalAction,
  updateGoalAction,
  type PlanResult,
} from "@/lib/plan/actions";
import type {
  AnnualGoal,
  CascadeStatus,
  Profile,
  StrategicFocusArea,
} from "@/lib/types";
import { CompleteConfirmDialog } from "@/components/plan/CompleteConfirmDialog";
import { StatusPicker } from "../../StatusPicker";
import heroStyles from "@/components/plan/DetailHero.module.css";
import styles from "../../plan-detail.module.css";

// Annual Goal hero card with an inline read/edit toggle. Mirrors the
// SFA hero pattern — same card in both states, Edit at the bottom
// flips fields into inputs, Save closes on success.

const STATUS_LABELS: Record<CascadeStatus, string> = {
  not_started: "Not started",
  on_track: "On track",
  behind: "Behind",
  complete: "Complete",
  ongoing: "Ongoing",
};

const INITIAL: PlanResult<AnnualGoal> = { ok: false, message: "" };

export type GoalHeroPanelProps = {
  goal: AnnualGoal;
  people: Pick<Profile, "id" | "full_name">[];
  sfaOptions: Pick<StrategicFocusArea, "id" | "title">[];
  sfa: Pick<StrategicFocusArea, "id" | "title"> | null;
  owner: Pick<Profile, "id" | "full_name"> | null;
  percent: number | null;
  priorityCount: number;
  openCommitmentsCount: number;
  isAdmin: boolean;
  isOwner: boolean;
};

export function GoalHeroPanel({
  goal,
  people,
  sfaOptions,
  sfa,
  owner,
  percent,
  priorityCount,
  openCommitmentsCount,
  isAdmin,
  isOwner,
}: GoalHeroPanelProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completePending, startComplete] = useTransition();
  const [archiving, startArchive] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<
    PlanResult<AnnualGoal>,
    FormData
  >(updateGoalAction, INITIAL);

  function onArchive() {
    if (
      !window.confirm(
        `Archive "${goal.title}"? Priorities and commitments under it stay intact and can be restored later.`
      )
    ) {
      return;
    }
    setArchiveError(null);
    startArchive(async () => {
      const result = await archiveGoalAction(goal.id, true);
      if (!result.ok) {
        setArchiveError(result.message);
        return;
      }
      router.push("/plan");
      router.refresh();
    });
  }

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const saved = state && "ok" in state && state.ok;

  useEffect(() => {
    if (saved && !pending && editing) setEditing(false);
  }, [saved, pending, editing]);

  function runComplete() {
    setCompleteError(null);
    startComplete(async () => {
      const result = await completeGoalAction(goal.id);
      if (!result.ok) {
        setCompleteError(result.message);
      } else {
        setConfirmingComplete(false);
      }
    });
  }

  const alreadyComplete = goal.status === "complete";

  return (
    <div className={heroStyles.wrap}>
      <div className={heroStyles.band}>
        <div className={heroStyles.bandInner}>
          <Link href="/plan" className={heroStyles.crumb}>
            ← Back to plan
          </Link>
        </div>
      </div>

      <div className={heroStyles.card}>
        <div className={heroStyles.eyebrow}>Annual Goal</div>

        {editing ? (
          <form action={formAction} className={styles.form}>
            <input type="hidden" name="id" value={goal.id} />

            <div className={styles.fieldWide}>
              <label htmlFor="goal-title" className={styles.label}>
                Title
              </label>
              <input
                id="goal-title"
                name="title"
                defaultValue={goal.title}
                required
                className={styles.inlineTitleInput}
                disabled={pending}
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="goal-sfa" className={styles.label}>
                Focus area
              </label>
              <select
                id="goal-sfa"
                name="sfa_id"
                defaultValue={goal.sfa_id ?? ""}
                className={styles.select}
                disabled={pending}
              >
                <option value="">Not linked</option>
                {sfaOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="goal-owner" className={styles.label}>
                Owner
              </label>
              <select
                id="goal-owner"
                name="owner_id"
                defaultValue={goal.owner_id ?? ""}
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
              <label htmlFor="goal-target" className={styles.label}>
                Target date
              </label>
              <input
                id="goal-target"
                name="target_date"
                type="date"
                defaultValue={goal.target_date ?? ""}
                className={styles.input}
                disabled={pending}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="goal-status" className={styles.label}>
                Status
              </label>
              <select
                id="goal-status"
                name="status"
                defaultValue={goal.status}
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
              <label htmlFor="goal-description" className={styles.label}>
                Description
              </label>
              <textarea
                id="goal-description"
                name="description"
                defaultValue={goal.description ?? ""}
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
            <h1 className={heroStyles.title}>{goal.title}</h1>
            <span className="aims-rule" aria-hidden="true" />
            <div className={heroStyles.meta}>
              {sfa ? (
                <Link href={`/plan/sfa/${sfa.id}`} className={styles.rowTitle}>
                  Focus area: {sfa.title}
                </Link>
              ) : (
                <span>Not linked to a focus area</span>
              )}
              <span>·</span>
              <span>Owner: {owner?.full_name ?? "Unassigned"}</span>
              {goal.target_date ? (
                <>
                  <span>·</span>
                  <span>Target {goal.target_date}</span>
                </>
              ) : null}
              <span>·</span>
              <StatusChip status={goal.status} />
              <span>·</span>
              <ProgressBar percent={percent} label="No priorities yet" />
            </div>
            <div className={heroStyles.body}>
              {goal.description ? (
                <p className={styles.bodyText}>{goal.description}</p>
              ) : null}

              {isOwner && !isAdmin ? (
                <StatusPicker
                  level="goal"
                  id={goal.id}
                  current={goal.status}
                />
              ) : null}

              {isAdmin ? (
                <div className={styles.editTrigger}>
                  {!alreadyComplete ? (
                    <button
                      type="button"
                      className={styles.editLink}
                      onClick={() => setConfirmingComplete(true)}
                      disabled={archiving}
                    >
                      Mark complete
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.editLink}
                    onClick={() => setEditing(true)}
                    disabled={archiving}
                  >
                    Edit annual goal
                  </button>
                  <button
                    type="button"
                    className={styles.archiveLink}
                    onClick={onArchive}
                    disabled={archiving}
                  >
                    {archiving ? "Archiving…" : "Archive"}
                  </button>
                </div>
              ) : null}
              {archiveError ? (
                <p role="alert" className={styles.errorMessage}>
                  {archiveError}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>

      <CompleteConfirmDialog
        open={confirmingComplete}
        title="Mark goal complete?"
        body={
          <>
            <p>
              This marks the goal Complete
              {priorityCount > 0 ? (
                <>
                  , its{" "}
                  <strong>
                    {priorityCount} active{" "}
                    {priorityCount === 1 ? "priority" : "priorities"}
                  </strong>{" "}
                  Complete
                </>
              ) : null}
              {openCommitmentsCount > 0 ? (
                <>
                  , and closes{" "}
                  <strong>
                    {openCommitmentsCount} open{" "}
                    {openCommitmentsCount === 1 ? "commitment" : "commitments"}
                  </strong>{" "}
                  as Kept.
                </>
              ) : (
                <>.</>
              )}
            </p>
            {openCommitmentsCount > 0 ? (
              <p style={{ margin: 0, color: "var(--text-muted)" }}>
                If any of those commitments were actually abandoned, cancel
                and resolve them as Closed with a reason first.
              </p>
            ) : null}
            {completeError ? (
              <p role="alert" style={{ margin: 0, color: "var(--aims-danger)" }}>
                {completeError}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Complete it"
        pending={completePending}
        onConfirm={runComplete}
        onCancel={() => {
          if (!completePending) {
            setConfirmingComplete(false);
            setCompleteError(null);
          }
        }}
      />
    </div>
  );
}
