"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  createFunctionRoleAction,
  updateFunctionRoleAction,
  deleteFunctionRoleAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type { FunctionRole } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "../../chart.module.css";

// Roles & Responsibilities editor. Same rhythm as the commitment
// row: an always-live draft input at the bottom, Enter to save,
// focus jumps back for the next one. The trigger-created default
// "Lead, Track, Decide" row is locked (no edit, no delete).

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

  if (!editing || !canEdit) {
    return (
      <div className={styles.roleRow}>
        <div className={styles.roleMain}>
          <span className={styles.roleTitle}>{role.title}</span>
          {role.body ? <p className={styles.roleBody}>{role.body}</p> : null}
        </div>
        {canEdit ? (
          <div className={styles.roleActions}>
            <button
              type="button"
              className={styles.roleGhostButton}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <DeleteRoleButton roleId={role.id} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <EditRoleForm role={role} onDone={() => setEditing(false)} />
  );
}

function EditRoleForm({
  role,
  onDone,
}: {
  role: FunctionRole;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ChartResult<FunctionRole>,
    FormData
  >(updateFunctionRoleAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className={styles.roleEditForm}>
      <input type="hidden" name="id" value={role.id} />
      <input
        type="text"
        name="title"
        defaultValue={role.title}
        className={styles.roleInput}
        placeholder="Responsibility"
        required
        disabled={pending}
        autoFocus
      />
      <textarea
        name="body"
        defaultValue={role.body ?? ""}
        className={styles.roleTextarea}
        placeholder="Detail (optional)"
        rows={2}
        disabled={pending}
      />
      {errorMessage ? (
        <p role="alert" className={styles.roleError}>
          {errorMessage}
        </p>
      ) : null}
      <div className={styles.roleEditActions}>
        <button
          type="button"
          className={styles.roleGhostButton}
          onClick={onDone}
          disabled={pending}
        >
          Cancel
        </button>
        <button type="submit" className={styles.rolePrimaryButton} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
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
        className={styles.roleDangerButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
      >
        Delete
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
      <button
        type="submit"
        className={styles.rolePrimaryButton}
        disabled={pending || !title.trim()}
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {errorMessage ? (
        <p role="alert" className={styles.roleError}>
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
