"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  leaveSharedConversationAction,
  listShareCandidatesAction,
  shareConversationAction,
  unshareConversationAction,
  updateShareAccessAction,
  type ShareAccessInput,
} from "@/lib/coach/actions";
import type {
  ConversationAccess,
  ShareCandidate,
  ShareeSummary,
} from "@/lib/coach/service";
import styles from "./ShareChatButton.module.css";

// Chat-header slot: owner sees a Share button; sharees see a muted
// "Shared with N" badge. Both open the same modal, but the modal
// renders in read-only mode for sharees (list + leave button) and
// in edit mode for the owner (invite + list + per-row controls).

export function ShareChatButton({
  conversationId,
  access,
  shares,
}: {
  conversationId: string;
  access: ConversationAccess;
  shares: readonly ShareeSummary[];
}) {
  const [open, setOpen] = useState(false);
  const label =
    shares.length === 0
      ? "Share"
      : `Shared with ${shares.length}`;
  const isOwner = access === "owner";
  return (
    <>
      <button
        type="button"
        className={isOwner ? styles.shareButton : styles.shareBadge}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open ? (
        <ShareModal
          conversationId={conversationId}
          access={access}
          initialShares={shares}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ShareModal({
  conversationId,
  access,
  initialShares,
  onClose,
}: {
  conversationId: string;
  access: ConversationAccess;
  initialShares: readonly ShareeSummary[];
  onClose: () => void;
}) {
  const isOwner = access === "owner";
  const router = useRouter();
  const [shares, setShares] = useState<ShareeSummary[]>(
    Array.from(initialShares)
  );
  const [candidates, setCandidates] = useState<ShareCandidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [accessChoice, setAccessChoice] = useState<ShareAccessInput>("write");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Only owners fetch candidates — the server action rejects
  // non-owners anyway. Fire once on mount.
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    void listShareCandidatesAction(conversationId).then((res) => {
      if (cancelled) return;
      if (res.ok) setCandidates(res.items);
      else setError(res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, isOwner]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    const q = query.trim().toLowerCase();
    if (!q) return candidates.slice(0, 20);
    return candidates
      .filter((c) => c.full_name.toLowerCase().includes(q))
      .slice(0, 20);
  }, [candidates, query]);

  const doShare = useCallback(async () => {
    if (!selectedId) return;
    setPending(true);
    setError(null);
    const res = await shareConversationAction(
      conversationId,
      selectedId,
      accessChoice
    );
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    // Optimistically add to the local shares list and remove from
    // candidates so the same person can't be added twice while the
    // page is still open.
    const added = candidates?.find((c) => c.id === selectedId);
    if (added) {
      setShares((prev) => [
        ...prev,
        {
          profile_id: added.id,
          full_name: added.full_name,
          avatar_url: added.avatar_url,
          access: accessChoice,
        },
      ]);
      setCandidates((prev) =>
        prev ? prev.filter((c) => c.id !== selectedId) : prev
      );
    }
    setSelectedId(null);
    setQuery("");
    router.refresh();
  }, [selectedId, accessChoice, conversationId, candidates, router]);

  const doUpdate = useCallback(
    async (profileId: string, next: ShareAccessInput) => {
      setError(null);
      const res = await updateShareAccessAction(
        conversationId,
        profileId,
        next
      );
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setShares((prev) =>
        prev.map((s) =>
          s.profile_id === profileId ? { ...s, access: next } : s
        )
      );
      router.refresh();
    },
    [conversationId, router]
  );

  const doRemove = useCallback(
    async (profileId: string) => {
      setError(null);
      const res = await unshareConversationAction(conversationId, profileId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setShares((prev) => prev.filter((s) => s.profile_id !== profileId));
      // Add them back to the candidate list so the owner can re-add
      // if it was an accident.
      if (candidates) {
        // We don't have their position here; re-fetch is easiest.
        void listShareCandidatesAction(conversationId).then((res2) => {
          if (res2.ok) setCandidates(res2.items);
        });
      }
      router.refresh();
    },
    [conversationId, candidates, router]
  );

  const doLeave = useCallback(async () => {
    setPending(true);
    setError(null);
    const res = await leaveSharedConversationAction(conversationId);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    // Route away — the caller no longer has access to this thread.
    router.push("/ask-aimee");
  }, [conversationId, router]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2 id="share-title" className={styles.title}>
            {isOwner ? "Share this chat" : "Shared with"}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {isOwner ? (
          <p className={styles.subtitle}>
            Only people in your company can be added. Write lets them
            reply; read lets them follow along.
          </p>
        ) : (
          <p className={styles.subtitle}>
            Owner controls who can see or reply. You can leave at any
            time.
          </p>
        )}

        {isOwner ? (
          <div className={styles.inviteRow}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by name…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedId(null);
              }}
              disabled={pending}
            />
            <fieldset className={styles.accessGroup}>
              <legend className={styles.srOnly}>Access</legend>
              <label className={styles.accessOption}>
                <input
                  type="radio"
                  name="share-access"
                  value="write"
                  checked={accessChoice === "write"}
                  onChange={() => setAccessChoice("write")}
                  disabled={pending}
                />
                Write
              </label>
              <label className={styles.accessOption}>
                <input
                  type="radio"
                  name="share-access"
                  value="read"
                  checked={accessChoice === "read"}
                  onChange={() => setAccessChoice("read")}
                  disabled={pending}
                />
                Read
              </label>
            </fieldset>
          </div>
        ) : null}

        {isOwner && candidates !== null ? (
          filteredCandidates.length > 0 ? (
            <ul className={styles.candidateList}>
              {filteredCandidates.map((c) => {
                const selected = selectedId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={
                        selected ? styles.candidateRowActive : styles.candidateRow
                      }
                      onClick={() => setSelectedId(c.id)}
                      disabled={pending}
                    >
                      <span className={styles.candidateName}>{c.full_name}</span>
                      {c.position ? (
                        <span className={styles.candidatePosition}>
                          {c.position}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.emptyLine}>
              {query
                ? "No matches in your company."
                : candidates.length === 0
                  ? "Everyone in your company already has access."
                  : "Type a name to search."}
            </p>
          )
        ) : null}

        {isOwner ? (
          <div className={styles.inviteActions}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!selectedId || pending}
              onClick={() => void doShare()}
            >
              {pending ? "…" : "Add to chat"}
            </button>
          </div>
        ) : null}

        {shares.length > 0 ? (
          <>
            <h3 className={styles.sectionTitle}>People with access</h3>
            <ul className={styles.shareList}>
              {shares.map((s) => (
                <li key={s.profile_id} className={styles.shareRow}>
                  <div className={styles.shareIdentity}>
                    {s.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.avatar_url}
                        alt=""
                        className={styles.shareAvatar}
                      />
                    ) : (
                      <span
                        className={styles.shareAvatarFallback}
                        aria-hidden="true"
                      >
                        {initialsFor(s.full_name)}
                      </span>
                    )}
                    <span className={styles.shareName}>{s.full_name}</span>
                  </div>
                  {isOwner ? (
                    <div className={styles.shareControls}>
                      <select
                        className={styles.accessSelect}
                        value={s.access}
                        onChange={(e) =>
                          void doUpdate(
                            s.profile_id,
                            e.target.value as ShareAccessInput
                          )
                        }
                        aria-label={`Access for ${s.full_name}`}
                      >
                        <option value="write">Write</option>
                        <option value="read">Read</option>
                      </select>
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => void doRemove(s.profile_id)}
                        aria-label={`Remove ${s.full_name}`}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span className={styles.accessTag}>
                      {s.access === "write" ? "Write" : "Read"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : isOwner ? (
          <p className={styles.emptyLine}>Nobody has access yet.</p>
        ) : null}

        {!isOwner ? (
          <div className={styles.footerActions}>
            <button
              type="button"
              className={styles.leaveButton}
              onClick={() => void doLeave()}
              disabled={pending}
            >
              {pending ? "…" : "Leave this chat"}
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className={styles.errorNote}>
            {error}
          </p>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}
