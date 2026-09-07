"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  sendInviteAction,
  deleteUserAction,
  getInviteLinkAction,
} from "@/lib/auth/users";
import { setProfileStatusAction } from "@/lib/people/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ProfileStatus } from "@/lib/types";
import styles from "./people.module.css";

// Overflow menu that collapses every admin action for a roster row —
// Send/Resend invite, Deactivate/Reactivate, Delete — into a single
// three-dot button, so every row lays out at the same width
// alongside the Coach button. Was previously three separate ghost
// buttons of varying widths depending on status.
//
// The menu is PORTALLED to document.body and positioned fixed, rather
// than absolutely inside the row.
//
// It has to be. An absolutely positioned menu is clipped by any
// ancestor with a non-visible overflow, and both tables that use this
// have one: the platform dashboard wraps its table in .tableWrap
// (overflow-x: auto), and /people gives its table overflow-x: auto
// below 768px. Setting overflow-x alone is enough — CSS computes the
// other axis to auto whenever one axis is not visible — so the menu
// was cut off at the container's bottom edge with no way to reach the
// items below the fold. A fixed-position element in a portal is
// clipped by none of that.
//
// Consequence worth knowing: a fixed menu does not travel with its
// trigger on its own, so it is repositioned on scroll and resize.
// Repositioning rather than closing, because this table scrolls
// horizontally and a stray trackpad nudge on the way to the menu
// should not dismiss it.

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
  // Fallback slot for the copy-link path: when navigator.clipboard
  // fails (permissions denied, non-secure context, etc.) we surface
  // the raw link so the admin can select + copy it manually.
  const [manualCopyLink, setManualCopyLink] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Viewport coordinates for the portalled menu. Null while closed.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Close on outside click or Escape. The menu is no longer inside
  // wrapRef, so a click on one of its own items would read as
  // "outside" and close the menu before the handler ran; both refs
  // have to be consulted.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
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

  // Where the menu goes: below the trigger and right-aligned with it,
  // unless that would run off the bottom of the viewport, in which
  // case above. Measured rather than estimated, because the menu's
  // height depends on how many actions this particular row offers.
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + 4;
    const fitsBelow = below + height <= window.innerHeight - 8;
    setPos({
      top: fitsBelow ? below : Math.max(8, rect.top - height - 4),
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  // Before paint, so the menu is never seen in the wrong place first.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    reposition();
  }, [open, reposition]);

  // A fixed element does not move with its trigger, so it has to be
  // told to. Repositioning rather than closing: closing on scroll
  // means a stray horizontal trackpad nudge on the way to the menu
  // dismisses it, and the table this lives in scrolls horizontally by
  // design. Capture phase, because the scroll that moves the row is
  // usually an inner container's rather than the window's.
  useEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, reposition]);

  // Invite actions (send email, copy link) only apply while the user
  // hasn't accepted yet. An active user is already in the app; a
  // deactivated user should be Reactivated, not re-invited. Both cases
  // used to render "Resend invite" which was misleading.
  const showInviteActions = status === "pending";
  const inviteLabel = "Send invite";

  function runInvite() {
    setOpen(false);
    startTransition(async () => {
      const result = await sendInviteAction(profileId);
      setMessage(result.ok ? "Invite sent." : result.message);
    });
  }

  function runCopyLink() {
    setOpen(false);
    setManualCopyLink(null);
    startTransition(async () => {
      const result = await getInviteLinkAction(profileId);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      // Attempt the clipboard write first; fall back to inline
      // display if the browser denies it (missing user-gesture
      // window, non-HTTPS, permissions blocked).
      try {
        await navigator.clipboard.writeText(result.link);
        setMessage("Link copied — expires in 24h.");
      } catch {
        setManualCopyLink(result.link);
        setMessage("Copy this link — expires in 24h.");
      }
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

  // Nothing to offer means no control. The caller's own row hits this:
  // canDelete and canToggleStatus are both false there, and an active
  // user has no invite actions, so every branch below renders nothing
  // and the menu opens as an empty box. A three-dot button that does
  // visibly nothing reads as broken. Checked after the hooks above,
  // never before, so the hook order stays stable across renders.
  const hasAnyAction =
    showInviteActions || showDeactivate || showReactivate || canDelete;
  if (!hasAnyAction) return null;

  return (
    <div ref={wrapRef} className={styles.moreWrap}>
      <button
        ref={triggerRef}
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
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.moreMenu}
              role="menu"
              style={{
                position: "fixed",
                top: pos?.top ?? 0,
                right: pos?.right ?? 0,
                // Hidden for the single frame between mount and
                // measurement. useLayoutEffect fills pos in before
                // paint, so this is never actually seen; it is here so
                // that if measurement ever fails the menu is absent
                // rather than parked in the corner of the screen.
                visibility: pos ? "visible" : "hidden",
              }}
            >
          {showInviteActions ? (
            <>
              <button
                type="button"
                role="menuitem"
                className={styles.moreMenuItem}
                onClick={runInvite}
              >
                {inviteLabel}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.moreMenuItem}
                onClick={runCopyLink}
              >
                Copy invite link
              </button>
            </>
          ) : null}
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
            </div>,
            document.body
          )
        : null}
      {message ? (
        <p className={styles.rowMessage} role="status">
          {message}
        </p>
      ) : null}
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
