"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { updateSfaAction, type PlanResult } from "@/lib/plan/actions";
import type { CascadeStatus, Profile, StrategicFocusArea } from "@/lib/types";
import { StatusPicker } from "../../StatusPicker";
import heroStyles from "@/components/plan/DetailHero.module.css";
import styles from "../../plan-detail.module.css";

// SFA hero card with an inline read/edit toggle. Same visual card in
// both states — Edit at the bottom flips the fields into inputs; Save
// writes and returns to read mode on success. Replaces the old pattern
// of showing an always-visible edit form in a separate section below.

const STATUS_LABELS: Record<CascadeStatus, string> = {
  not_started: "Not started",
  on_track: "On track",
  behind: "Behind",
  complete: "Complete",
  ongoing: "Ongoing",
};

const INITIAL: PlanResult<StrategicFocusArea> = { ok: false, message: "" };

export type SfaHeroPanelProps = {
  sfa: StrategicFocusArea;
  people: Pick<Profile, "id" | "full_name">[];
  sponsor: Pick<Profile, "id" | "full_name"> | null;
  percent: number | null;
  isAdmin: boolean;
  isSponsor: boolean;
};

export function SfaHeroPanel({
  sfa,
  people,
  sponsor,
  percent,
  isAdmin,
  isSponsor,
}: SfaHeroPanelProps) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<
    PlanResult<StrategicFocusArea>,
    FormData
  >(updateSfaAction, INITIAL);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const saved = state && "ok" in state && state.ok;

  // Auto-close on save success so the fresh server-rendered read view
  // takes over. `saved` stays true after subsequent unrelated re-renders,
  // so gate on the transition finishing to avoid re-closing after Cancel.
  useEffect(() => {
    if (saved && !pending && editing) setEditing(false);
  }, [saved, pending, editing]);

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
        <div className={heroStyles.eyebrow}>Strategic Focus Area</div>

        {editing ? (
          <form action={formAction} className={styles.form}>
            <input type="hidden" name="id" value={sfa.id} />

            <div className={styles.fieldWide}>
              <label htmlFor="sfa-title" className={styles.label}>
                Title
              </label>
              <input
                id="sfa-title"
                name="title"
                defaultValue={sfa.title}
                required
                className={styles.inlineTitleInput}
                disabled={pending}
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="sfa-sponsor" className={styles.label}>
                Sponsor
              </label>
              <select
                id="sfa-sponsor"
                name="sponsor_id"
                defaultValue={sfa.sponsor_id ?? ""}
                className={styles.select}
                disabled={pending}
              >
                <option value="">No sponsor yet</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="sfa-status" className={styles.label}>
                Status
              </label>
              <select
                id="sfa-status"
                name="status"
                defaultValue={sfa.status}
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
              <label htmlFor="sfa-description" className={styles.label}>
                Description
              </label>
              <textarea
                id="sfa-description"
                name="description"
                defaultValue={sfa.description ?? ""}
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
            <h1 className={heroStyles.title}>{sfa.title}</h1>
            <span className="aims-rule" aria-hidden="true" />
            <div className={heroStyles.meta}>
              <span>Sponsor: {sponsor?.full_name ?? "Unassigned"}</span>
              <span>·</span>
              <StatusChip status={sfa.status} />
              <span>·</span>
              <ProgressBar percent={percent} label="No progress yet" />
            </div>
            <div className={heroStyles.body}>
              {sfa.description ? (
                <p className={styles.bodyText}>{sfa.description}</p>
              ) : null}

              {isSponsor && !isAdmin ? (
                <StatusPicker
                  level="sfa"
                  id={sfa.id}
                  current={sfa.status}
                />
              ) : null}

              {isAdmin ? (
                <div className={styles.editTrigger}>
                  <button
                    type="button"
                    className={styles.editLink}
                    onClick={() => setEditing(true)}
                  >
                    Edit focus area
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
