"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { RdTarget } from "@/lib/role-descriptions/recommend";
import { SuggestOptionsPopover } from "./SuggestOptionsPopover";
import styles from "../../chart.module.css";

// Shared inline add/edit/delete list. Used for Decision Rights and
// Competency Indicators — both are function-scoped lists of titles
// with the same UX as Roles & Responsibilities minus the locked
// default row.
//
// Actions are passed as props (Next 15 supports serializable
// server-action references) so the two callers can point at
// function_decision_rights vs function_competencies without a
// duplicated component per entity.

type BaseItem = {
  id: string;
  function_id: string;
  title: string;
};

type CreateResult<T extends BaseItem> =
  | { ok: true; item: T }
  | { ok: false; message: string };

type RenameResult<T extends BaseItem> =
  | { ok: true; item: T }
  | { ok: false; message: string };

type DeleteResult = { ok: true } | { ok: false; message: string };

const INITIAL_CREATE = { ok: false as const, message: "" };

export function SimpleFunctionItemList<T extends BaseItem>({
  functionId,
  items,
  canEdit,
  singularLabel,
  addPlaceholder,
  createAction,
  renameAction,
  deleteAction,
  suggestTarget,
  suggestButtonLabel,
}: {
  functionId: string;
  items: T[];
  canEdit: boolean;
  singularLabel: string;
  addPlaceholder: string;
  createAction: (
    prev: CreateResult<T> | undefined,
    formData: FormData
  ) => Promise<CreateResult<T>>;
  renameAction: (id: string, newTitle: string) => Promise<RenameResult<T>>;
  deleteAction: (id: string) => Promise<DeleteResult>;
  // When present, renders a "Suggest options" popover under the
  // draft row. Omit (or pass undefined) to hide — for example when
  // the company doesn't have role_descriptions enabled.
  suggestTarget?: RdTarget;
  suggestButtonLabel?: string;
}) {
  return (
    <div className={styles.roleList}>
      {items.length === 0 && !canEdit ? (
        <p className={styles.emptyOutcomeLine}>None yet.</p>
      ) : null}
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          canEdit={canEdit}
          singularLabel={singularLabel}
          renameAction={renameAction}
          deleteAction={deleteAction}
        />
      ))}
      {canEdit ? (
        <DraftRow
          functionId={functionId}
          placeholder={addPlaceholder}
          createAction={createAction}
        />
      ) : null}
      {canEdit && suggestTarget ? (
        <SuggestOptionsPopover
          functionId={functionId}
          target={suggestTarget}
          buttonLabel={suggestButtonLabel ?? "Suggest options"}
          onSave={async (t, b) => {
            const fd = new FormData();
            fd.set("function_id", functionId);
            fd.set("title", t);
            if (b) fd.set("body", b);
            const r = await createAction(undefined, fd);
            return r.ok ? { ok: true } : { ok: false, message: r.message };
          }}
        />
      ) : null}
    </div>
  );
}

function ItemRow<T extends BaseItem>({
  item,
  canEdit,
  singularLabel,
  renameAction,
  deleteAction,
}: {
  item: T;
  canEdit: boolean;
  singularLabel: string;
  renameAction: (id: string, newTitle: string) => Promise<RenameResult<T>>;
  deleteAction: (id: string) => Promise<DeleteResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(item.title);
  }, [item.title]);

  function commit() {
    if (pending) return;
    const next = draft.trim();
    if (!next) {
      cancel();
      return;
    }
    if (next === item.title) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameAction(item.id, next);
      if (!result.ok) {
        setError(result.message);
      } else {
        setEditing(false);
      }
    });
  }

  function cancel() {
    setDraft(item.title);
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
          aria-label={`Edit ${singularLabel}`}
        />
      ) : canEdit ? (
        <button
          type="button"
          className={styles.roleTitleEditable}
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {item.title}
        </button>
      ) : (
        <span className={styles.roleTitle}>{item.title}</span>
      )}

      {canEdit ? (
        <DeleteButton
          id={item.id}
          singularLabel={singularLabel}
          deleteAction={deleteAction}
        />
      ) : null}
      {error ? (
        <span role="alert" className={styles.roleError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function DeleteButton({
  id,
  singularLabel,
  deleteAction,
}: {
  id: string;
  singularLabel: string;
  deleteAction: (id: string) => Promise<DeleteResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function run() {
    setConfirming(false);
    startTransition(async () => {
      const result = await deleteAction(id);
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
        aria-label={`Delete this ${singularLabel}`}
        title={`Delete this ${singularLabel}`}
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
        title={`Delete this ${singularLabel}?`}
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

function DraftRow<T extends BaseItem>({
  functionId,
  placeholder,
  createAction,
}: {
  functionId: string;
  placeholder: string;
  createAction: (
    prev: CreateResult<T> | undefined,
    formData: FormData
  ) => Promise<CreateResult<T>>;
}) {
  const [state, formAction, pending] = useActionState<
    CreateResult<T>,
    FormData
  >(createAction, INITIAL_CREATE);
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
        placeholder={placeholder}
        required
        disabled={pending}
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
