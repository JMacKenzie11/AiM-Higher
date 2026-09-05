"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteGuideAction,
  resendGuideInviteAction,
} from "@/lib/admin/guides-actions";
import { getInviteLinkAction } from "@/lib/auth/users";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "./admin.module.css";

// Account-level actions for one guide (Resend invite, Copy invite
// link, Delete) folded into a ⋯ overflow menu so the Actions column
// stays a single narrow control regardless of how many companies
// the guide is assigned to. Contextual per-company actions
// (Assign / Unassign) live in the Companies cell — see
// GuideCompaniesCell.

export function GuideRowActions({
  guideId,
  canManageAccount = true,
}: {
  guideId: string;
  // False when the row is a system_admin — invite/delete are not
  // meaningful for them (they already have an account and their
  // profile shouldn't be nuked from this panel). Rendering nothing
  // keeps the column tidy vs a disabled menu.
  canManageAccount?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [manualCopyLink, setManualCopyLink] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuWrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Below the hooks, deliberately. React requires the same hooks in
  // the same order on every render, so an early return above them
  // throws "rendered fewer hooks than expected" the moment a row
  // flips between manageable and not.
  if (!canManageAccount) return null;

  function runResendInvite() {
    setMenuOpen(false);
    setMsg(null);
    setManualCopyLink(null);
    startTransition(async () => {
      const r = await resendGuideInviteAction(guideId);
      setMsg(r.ok ? "Invite sent." : r.message);
    });
  }

  function runCopyInviteLink() {
    setMenuOpen(false);
    setMsg(null);
    setManualCopyLink(null);
    startTransition(async () => {
      const r = await getInviteLinkAction(guideId);
      if (!r.ok) {
        setMsg(r.message);
        return;
      }
      try {
        await navigator.clipboard.writeText(r.link);
        setMsg("Link copied — expires in 24h.");
      } catch {
        setManualCopyLink(r.link);
        setMsg("Copy this link — expires in 24h.");
      }
    });
  }

  function runDelete() {
    setConfirmDelete(false);
    setMsg(null);
    startTransition(async () => {
      const r = await deleteGuideAction(guideId);
      if (!r.ok) setMsg(r.message);
    });
  }

  return (
    <div className={styles.actionsCell}>
      <div ref={menuWrapRef} className={styles.moreWrap}>
        <button
          type="button"
          className={styles.moreButton}
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="More actions"
          disabled={pending}
        >
          {pending ? "…" : "⋯"}
        </button>
        {menuOpen ? (
          <div className={styles.moreMenu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.moreMenuItem}
              onClick={runResendInvite}
            >
              Resend invite
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.moreMenuItem}
              onClick={runCopyInviteLink}
            >
              Copy invite link
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${styles.moreMenuItem} ${styles.moreMenuItemDanger}`}
              onClick={() => {
                setMenuOpen(false);
                setConfirmDelete(true);
              }}
            >
              Delete guide
            </button>
          </div>
        ) : null}
      </div>

      {msg ? <p className={styles.inlineError}>{msg}</p> : null}
      {manualCopyLink ? (
        <input
          type="text"
          readOnly
          value={manualCopyLink}
          className={styles.manualLinkField}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          aria-label="Invite link — select and copy"
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this guide?"
        message="They'll be removed from the platform entirely and lose access to every assigned company."
        confirmLabel="Delete guide"
        tone="danger"
        onConfirm={runDelete}
        onCancel={() => setConfirmDelete(false)}
        pending={pending}
      />
    </div>
  );
}
