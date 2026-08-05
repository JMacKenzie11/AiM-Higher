"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  getPersonQuickViewAction,
  type PersonQuickView,
} from "@/lib/people/quick-view-action";
import type { Profile } from "@/lib/types";
import { OwnerPicker } from "./OwnerPicker";
import styles from "./commitments.module.css";

// Right-side slide-in drawer that opens when a commitment's owner
// name is clicked on /commitments. Answers the meeting-critical
// question "who is this and how are they doing?" without a page
// navigation, plus keeps reassign one click deeper (safer default
// than the old model where the same click triggered the reassign
// picker directly).
//
// Data model: fetched on open via a server action so /commitments
// doesn't over-fetch stats for every roster member up front. Cache
// per drawer instance — closing and re-opening the same person
// fires another fetch, which is fine for a low-frequency gesture.

type Props = {
  open: boolean;
  ownerId: string | null;
  ownerName: string;
  // Full roster for the reassign picker (only shown when canReassign).
  roster: Array<Pick<Profile, "id" | "full_name">>;
  canReassign: boolean;
  canCoach: boolean;
  onReassign: (ownerId: string) => void;
  onClose: () => void;
};

export function PersonQuickViewDrawer({
  open,
  ownerId,
  ownerName,
  roster,
  canReassign,
  canCoach,
  onReassign,
  onClose,
}: Props) {
  const [view, setView] = useState<PersonQuickView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [showReassign, setShowReassign] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portal target defers to after mount so SSR doesn't reach for
  // document.body. Without this the fixed-position overlay renders
  // inside the row's <li>, and if any grid/flex ancestor traps the
  // containing block the panel goes off-screen or under the layout.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !ownerId) return;
    setView(null);
    setError(null);
    setShowReassign(false);
    startLoad(async () => {
      const result = await getPersonQuickViewAction(ownerId);
      if (result.ok) setView(result.view);
      else setError(result.message);
    });
  }, [open, ownerId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const firstName = ownerName.split(" ")[0] ?? ownerName;

  return createPortal(
    <div
      className={styles.drawerOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-view-name"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className={styles.drawerPanel}>
        <header className={styles.drawerHeader}>
          <div>
            <div className={styles.drawerEyebrow}>Person</div>
            <h2 id="quick-view-name" className={styles.drawerTitle}>
              {ownerName}
            </h2>
            {view?.position ? (
              <p className={styles.drawerPosition}>{view.position}</p>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.drawerClose}
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden>
              <path
                d="M4 4 L12 12 M12 4 L4 12"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className={styles.drawerBody}>
          {loading && !view ? (
            <p className={styles.drawerMuted}>Loading…</p>
          ) : error ? (
            <p role="alert" className={styles.drawerError}>
              {error}
            </p>
          ) : view ? (
            <>
              <section className={styles.drawerStatRow}>
                <QuickStat
                  label="Follow-Through Rate"
                  value={
                    view.stats.keepRate === null
                      ? "—"
                      : `${view.stats.keepRate}%`
                  }
                  caption="This quarter"
                />
                <QuickStat
                  label="Open"
                  value={String(view.stats.openCount)}
                  caption="Commitments"
                />
                <QuickStat
                  label="Kept"
                  value={String(view.stats.keptCount)}
                />
                <QuickStat
                  label="Missed"
                  value={String(view.stats.missedCount)}
                />
              </section>

              <div className={styles.drawerActions}>
                {canCoach ? (
                  <Link
                    href={`/coach/${view.id}`}
                    className={styles.drawerPrimaryAction}
                    onClick={onClose}
                  >
                    Coach {firstName}
                  </Link>
                ) : null}
                <Link
                  href={`/people/${view.id}`}
                  className={styles.drawerSecondaryAction}
                  onClick={onClose}
                >
                  Open full scorecard →
                </Link>
              </div>

              {canReassign ? (
                <section className={styles.drawerReassign}>
                  <div className={styles.drawerReassignHeader}>
                    Reassign this commitment
                  </div>
                  {showReassign ? (
                    <OwnerPicker
                      roster={roster}
                      currentOwnerId={ownerId}
                      onSelect={(newId) => {
                        onReassign(newId);
                        onClose();
                      }}
                      disabled={false}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.drawerSecondaryAction}
                      onClick={() => setShowReassign(true)}
                    >
                      Pick a new owner
                    </button>
                  )}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body
  );
}

function QuickStat({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className={styles.drawerStat}>
      <span className={`${styles.drawerStatValue} aims-tabular`}>{value}</span>
      <span className={styles.drawerStatLabel}>{label}</span>
      {caption ? (
        <span className={styles.drawerStatCaption}>{caption}</span>
      ) : null}
    </div>
  );
}
