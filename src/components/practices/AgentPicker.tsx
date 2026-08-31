"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { setConversationAgentAction } from "@/lib/coach/actions";
import {
  PRACTICE_CATEGORIES,
  type PracticeCategory,
} from "@/lib/practices/categories";
import type { Practice } from "@/lib/practices/registry";
import styles from "./AgentPicker.module.css";

// Composer-side agent selector. Replaces the retired Practice
// Coaches tab as the browse-and-choose surface. Rendered inside
// the chat header once we're past the empty state; disabled after
// the first user message lands (the server action also refuses
// there, so this is UX polish).
//
// Two shapes for the trigger:
//   - locked=false: pill reads "Ask Aimee" or the current agent
//     name; click opens the modal.
//   - locked=true: same pill but non-interactive, no chevron —
//     reads as a persistent label so the leader still knows what
//     they're talking to.

export type AgentAttachedInfo = {
  practiceId: string | null;
  openerContent: string | null;
  runGenerateOpener: boolean;
};

export function AgentPicker({
  conversationId,
  practices,
  currentAgent,
  locked,
  onAgentAttached,
}: {
  conversationId: string;
  // Registry entries the caller is allowed to launch (already
  // gated by role at the page level).
  practices: readonly Practice[];
  currentAgent: Practice | null;
  locked: boolean;
  // Called after a successful attach. ChatView owns the local
  // message state so it wipes optimistic messages, seeds any
  // scripted opener, and kicks off the generate flow if signalled.
  // router.refresh() can't drive this because useState only reads
  // its initial value once — a fresh `initialMessages` prop after
  // refresh would not update the client state.
  onAgentAttached: (info: AgentAttachedInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = currentAgent ? currentAgent.title : "Ask Aimee";

  if (locked) {
    return (
      <span
        className={styles.triggerLocked}
        title={
          currentAgent
            ? `You're chatting with the ${currentAgent.title}`
            : "You're chatting with Aimee"
        }
      >
        <AgentGlyph />
        {label}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-label={`Change agent (current: ${label})`}
      >
        <AgentGlyph />
        <span>{label}</span>
        <ChevronGlyph />
      </button>
      {open ? (
        <AgentPickerModal
          conversationId={conversationId}
          practices={practices}
          currentAgent={currentAgent}
          onClose={() => setOpen(false)}
          onAgentAttached={onAgentAttached}
        />
      ) : null}
    </>
  );
}

function AgentPickerModal({
  conversationId,
  practices,
  currentAgent,
  onClose,
  onAgentAttached,
}: {
  conversationId: string;
  practices: readonly Practice[];
  currentAgent: Practice | null;
  onClose: () => void;
  onAgentAttached: (info: AgentAttachedInfo) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const grouped = useMemo(() => {
    const byCategory = new Map<PracticeCategory, Practice[]>();
    for (const cat of PRACTICE_CATEGORIES) byCategory.set(cat, []);
    for (const p of practices) byCategory.get(p.category)?.push(p);
    return PRACTICE_CATEGORIES
      .map((cat) => ({ category: cat, items: byCategory.get(cat) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [practices]);

  function pick(agentId: string | null) {
    if (pending) return;
    setPendingId(agentId ?? "clear");
    setError(null);
    startTransition(async () => {
      const res = await setConversationAgentAction(conversationId, agentId);
      if (!res.ok) {
        setError(res.message);
        setPendingId(null);
        return;
      }
      // Hand full state control to ChatView. It wipes optimistic
      // messages, inserts the scripted opener (if any), and kicks
      // off the generate flow when signalled.
      onAgentAttached({
        practiceId: res.practiceId,
        openerContent: res.openerContent,
        runGenerateOpener: res.runGenerateOpener,
      });
      onClose();
      // Still refresh so the server-rendered header updates
      // (title, empty state text) and any other page-level state
      // stays consistent.
      router.refresh();
    });
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-picker-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className={styles.dialog}>
        <div className={styles.header}>
          <div className={styles.headerText}>
            <h2 id="agent-picker-title" className={styles.title}>
              Choose an agent
            </h2>
            <p className={styles.subtitle}>
              Pick an agent to run this chat as a guided practice,
              or keep Aimee for open-ended thinking.
            </p>
          </div>
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

        <div className={styles.body}>
          {currentAgent ? (
            <div className={styles.currentRow}>
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => pick(null)}
                disabled={pending}
              >
                {pendingId === "clear" ? "…" : "Clear (use Aimee)"}
              </button>
            </div>
          ) : null}

          {grouped.map(({ category, items }) => (
            <section key={category} className={styles.categoryGroup}>
              <h3 className={styles.categoryHeader}>{category}</h3>
              <ul className={styles.rowList}>
                {items.map((practice) => {
                  const isCurrent = currentAgent?.id === practice.id;
                  return (
                    <li key={practice.id}>
                      <button
                        type="button"
                        className={
                          isCurrent ? styles.rowCurrent : styles.row
                        }
                        onClick={() => pick(practice.id)}
                        disabled={pending || isCurrent}
                        aria-busy={pendingId === practice.id}
                      >
                        <span className={styles.rowMain}>
                          <span className={styles.rowTitle}>
                            {practice.title}
                          </span>
                          <span className={styles.rowDescription}>
                            {practice.description}
                          </span>
                        </span>
                        {isCurrent ? (
                          <span className={styles.rowCurrentTag}>Current</span>
                        ) : (
                          <ChevronGlyph />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {error ? (
            <p role="alert" className={styles.errorNote}>
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function AgentGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M12 8V4" />
      <circle cx="12" cy="4" r="1" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
