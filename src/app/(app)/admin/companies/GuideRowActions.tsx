"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  assignGuideAction,
  deleteGuideAction,
  resendGuideInviteAction,
  unassignGuideAction,
} from "@/lib/admin/guides-actions";
import { getInviteLinkAction } from "@/lib/auth/users";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Company } from "@/lib/types";
import styles from "./admin.module.css";

// Row-level actions for one guide. Contextual actions (Assign to
// another company, Unassign from a company) stay inline because
// they're per-company and reference specific chips. Account-level
// actions (Resend invite, Copy invite link, Delete) fold into a
// ⋯ overflow menu so the row lays out predictably regardless of
// how many companies the guide is assigned to.

export function GuideRowActions({
  guideId,
  assignedCompanyIds,
  allCompanies,
}: {
  guideId: string;
  assignedCompanyIds: string[];
  allCompanies: Pick<Company, "id" | "name">[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [pickCompanyId, setPickCompanyId] = useState<string>("");
  const [pendingUnassign, setPendingUnassign] = useState<
    Pick<Company, "id" | "name"> | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [manualCopyLink, setManualCopyLink] = useState<string | null>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  const availableToAssign = allCompanies.filter(
    (c) => !assignedCompanyIds.includes(c.id)
  );

  function run(fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setMsg(r.message);
    });
  }

  // Close menu on outside click / Escape.
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

  function runResendInvite() {
    setMenuOpen(false);
    setMsg(null);
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

  return (
    <div className={styles.actionsCell}>
      {availableToAssign.length > 0 ? (
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <select
            value={pickCompanyId}
            onChange={(e) => setPickCompanyId(e.target.value)}
            disabled={pending}
            className={styles.select}
          >
            <option value="">Assign to…</option>
            {availableToAssign.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={pending || !pickCompanyId}
            onClick={() => {
              const target = pickCompanyId;
              if (!target) return;
              setPickCompanyId("");
              run(() => assignGuideAction(guideId, target));
            }}
          >
            Assign
          </button>
        </div>
      ) : null}

      {assignedCompanyIds.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            flexWrap: "wrap",
          }}
        >
          {assignedCompanyIds.map((cid) => {
            const c = allCompanies.find((x) => x.id === cid);
            if (!c) return null;
            return (
              <button
                key={cid}
                type="button"
                className={styles.ghostButton}
                disabled={pending}
                title={`Unassign from ${c.name}`}
                onClick={() => setPendingUnassign(c)}
              >
                {c.name} ×
              </button>
            );
          })}
        </div>
      ) : null}

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
        open={pendingUnassign !== null}
        title={
          pendingUnassign
            ? `Unassign from ${pendingUnassign.name}?`
            : "Unassign?"
        }
        message="This guide will lose access to the company. Re-assign later from this same panel if it's a temporary rotation."
        confirmLabel="Unassign"
        tone="danger"
        onConfirm={() => {
          if (!pendingUnassign) return;
          const cid = pendingUnassign.id;
          setPendingUnassign(null);
          run(() => unassignGuideAction(guideId, cid));
        }}
        onCancel={() => setPendingUnassign(null)}
        pending={pending}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this guide?"
        message="They'll be removed from the platform entirely and lose access to every assigned company."
        confirmLabel="Delete guide"
        tone="danger"
        onConfirm={() => {
          setConfirmDelete(false);
          run(() => deleteGuideAction(guideId));
        }}
        onCancel={() => setConfirmDelete(false)}
        pending={pending}
      />
    </div>
  );
}
