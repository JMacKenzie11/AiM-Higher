"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import {
  createFunctionRoleAction,
  deleteFunctionRoleAction,
  renameFunctionRoleAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type { FunctionRole } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "../../chart.module.css";

// Roles & Responsibilities editor.
//   Baseline row (Lead, Track, Decide) is locked.
//   Every other row is click-to-edit inline: click the title, type,
//   blur or Enter to save, Escape to cancel. A trash icon on the
//   right deletes with a confirm.
//   Draft row at the bottom stays live: type + Enter to add another.

const INITIAL: ChartResult<FunctionRole> = { ok: false, message: "" };

export function RolesList({
  functionId,
  roles,
  canEdit,
}: {
  functionId: string;
  roles: FunctionRole[];
  canEdit: boolean;
}) {
  return (
    <div className={styles.roleList}>
      {roles.map((role) =>
        role.is_default ? (
          <DefaultRoleRow key={role.id} role={role} />
        ) : (
          <UserRoleRow key={role.id} role={role} canEdit={canEdit} />
        )
      )}
      {canEdit ? <DraftRoleRow functionId={functionId} /> : null}
    </div>
  );
}

function DefaultRoleRow({ role }: { role: FunctionRole }) {
  return (
    <div className={`${styles.roleRow} ${styles.roleRowDefault}`}>
      <span className={styles.roleTitle}>{role.title}</span>
      <span className={styles.roleBadge}>Baseline</span>
    </div>
  );
}

function UserRoleRow({ role, canEdit }: { role: FunctionRole; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(role.title);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(role.title);
  }, [role.title]);

  function commit() {
    if (pending) return;
    const next = draft.trim();
    if (!next) {
      cancel();
      return;
    }
    if (next === role.title) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameFunctionRoleAction(role.id, next);
      if (!result.ok) {
        setError(result.message);
      } else {
        setEditing(false);
      }
    });
  }

  function cancel() {
    setDraft(role.title);
    setEditing(false);
    setError(null);
  }

  return (
    <div className={styles.roleRow}>
      {editing && canEdit ? (
        <input
          className={styles.roleTitleInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          autoFocus
          disabled={pending}
          aria-label="Edit responsibility"
        />
      ) : canEdit ? (
        <button
          type="button"
          className={styles.roleTitleEditable}
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {role.title}
        </button>
      ) : (
        <span className={styles.roleTitle}>{role.title}</span>
      )}

      {canEdit ? <DeleteRoleButton roleId={role.id} /> : null}
      {error ? (
        <span role="alert" className={styles.roleError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function DeleteRoleButton({ roleId }: { roleId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function run() {
    setConfirming(false);
    startTransition(async () => {
      const result = await deleteFunctionRoleAction(roleId);
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.roleDeleteIcon}
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Delete this responsibility"
        title="Delete this responsibility"
      >
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
          <path
            d="M4 5 h8 v8 a1 1 0 0 1 -1 1 h-6 a1 1 0 0 1 -1 -1 z M6.5 5 V3.5 a1 1 0 0 1 1 -1 h1 a1 1 0 0 1 1 1 V5 M3 5 h10"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <ConfirmDialog
        open={confirming}
        title="Delete this responsibility?"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {message ? (
        <p role="alert" className={styles.roleError}>
          {message}
        </p>
      ) : null}
    </>
  );
}

function DraftRoleRow({ functionId }: { functionId: string }) {
  const [state, formAction, pending] = useActionState<
    ChartResult<FunctionRole>,
    FormData
  >(createFunctionRoleAction, INITIAL);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      setTitle("");
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className={`${styles.roleRow} ${styles.roleRowDraft}`}>
      <input type="hidden" name="function_id" value={functionId} />
      <input
        ref={inputRef}
        type="text"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setTitle("");
          }
        }}
        className={styles.roleInput}
        placeholder="Add a responsibility — press Enter to save."
        required
        disabled={pending}
        aria-label="New responsibility"
      />
      {pending ? (
        <span className={styles.roleSavingHint}>Saving…</span>
      ) : null}
      {errorMessage ? (
        <p role="alert" className={styles.roleError}>
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
