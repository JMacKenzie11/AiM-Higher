"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { sendInviteAction, deleteUserAction } from "@/lib/auth/users";
import { setProfileStatusAction } from "@/lib/people/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ProfileStatus } from "@/lib/types";
import styles from "./people.module.css";

// Overflow menu that collapses every admin action for a roster row —
// Send/Resend invite, Deactivate/Reactivate, Delete — into a single
// three-dot button, so every row lays out at the same width
// alongside the Coach button. Was previously three separate ghost
// buttons of varying widths depending on status.

type Props = {
  profileId: string;
  status: ProfileStatus;
  canDelete: boolean;
  canToggleStatus: boolean;
};

export function RowActionsMenu({
  profileId,
  status,
  canDelete,
  canToggleStatus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const inviteLabel = status === "pending" ? "Send invite" : "Resend invite";

  function runInvite() {
    setOpen(false);
    startTransition(async () => {
      const result = await sendInviteAction(profileId);
      setMessage(result.ok ? "Invite sent." : result.message);
    });
  }

  function runDelete() {
    setConfirmingDelete(false);
    startTransition(async () => {
      const result = await deleteUserAction(profileId);
      if (!result.ok) setMessage(result.message);
    });
  }

  function runToggleStatus(next: "active" | "inactive") {
    setConfirmingDeactivate(false);
    setOpen(false);
    startTransition(async () => {
      const result = await setProfileStatusAction(profileId, next);
      if (!result.ok) setMessage(result.message);
    });
  }

  const showDeactivate = canToggleStatus && status === "active";
  const showReactivate = canToggleStatus && status === "inactive";

  return (
    <div ref={wrapRef} className={styles.moreWrap}>
      <button
        type="button"
        className={styles.moreButton}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More actions"
        disabled={pending}
      >
        {pending ? "…" : "⋯"}
      </button>
      {open ? (
        <div className={styles.moreMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.moreMenuItem}
            onClick={runInvite}
          >
            {inviteLabel}
          </button>
          {showDeactivate ? (
            <button
              type="button"
              role="menuitem"
              className={styles.moreMenuItem}
              onClick={() => {
                setOpen(false);
                setConfirmingDeactivate(true);
              }}
            >
              Deactivate
            </button>
          ) : null}
          {showReactivate ? (
            <button
              type="button"
              role="menuitem"
              className={styles.moreMenuItem}
              onClick={() => runToggleStatus("active")}
            >
              Reactivate
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              role="menuitem"
              className={`${styles.moreMenuItem} ${styles.moreMenuItemDanger}`}
              onClick={() => {
                setOpen(false);
                setConfirmingDelete(true);
              }}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p className={styles.rowMessage} role="status">
          {message}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this user? This can't be undone."
        message="Their commitments stay on file as Unassigned, and their weekly numbers and team memberships keep their history. Their sign-in, private coaching notes, and strengths assessment are removed with them."
        confirmLabel="Delete user"
        tone="danger"
        onConfirm={runDelete}
        onCancel={() => setConfirmingDelete(false)}
        pending={pending}
      />
      <ConfirmDialog
        open={confirmingDeactivate}
        title="Deactivate this person?"
        message="They won't be able to sign in. Their commitments and history stay intact and reappear if you reactivate them later."
        confirmLabel="Deactivate"
        tone="danger"
        onConfirm={() => runToggleStatus("inactive")}
        onCancel={() => setConfirmingDeactivate(false)}
        pending={pending}
      />
    </div>
  );
}
