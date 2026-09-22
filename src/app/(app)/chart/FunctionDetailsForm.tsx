"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateFunctionDetailsAction } from "@/lib/chart/actions";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import type { Profile } from "@/lib/types";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "./chart.module.css";

// The function's name, where it sits, and who is in the seat.
// One form, one Save, two surfaces.
//
// ---- WHY IT REPLACED THREE CLICK-TO-EDIT CONTROLS ------------
//
// These were three affordances that each wrote the moment they lost
// focus: a title you clicked to rename, a Move control, a Change
// control on the seat. That is how the detail page had always
// worked and the drawer inherited it wholesale.
//
// It is not how a drawer behaves anywhere else in this app.
// /measures collects a form and commits it on Save; so does every
// /plan panel. A panel where three things save themselves at three
// different moments, with no button in sight, is a different
// product from the one around it.
//
// ---- WHAT DID NOT MOVE ----------------------------------------
//
// Roles & Responsibilities still add and delete immediately, and
// that is the deliberate half of the answer. A row carrying a trash
// icon that does not actually delete until you press a button
// further down is a worse lie than an immediate delete: the icon
// says "gone" and means "gone later, maybe". Lists commit; fields
// batch. That is the same split /measures already draws.
//
// ---- THE SAME COMPONENT ON BOTH SURFACES ----------------------
//
// The drawer and /chart/function/[id] render this one file, which
// is what stops a field existing in one place and not the other.
// It is why the page's H1 stopped being editable in the hero: a
// name that is a form field here and a click-to-edit heading there
// is exactly the drift this arrangement exists to prevent.

export type FunctionDetailsValues = {
  title: string;
  parentFunctionId: string | null;
  leadId: string | null;
};

export function FunctionDetailsForm({
  functionId,
  initial,
  parentOptions,
  roster,
  canEdit,
  onSaved,
  onDirtyChange,
}: {
  functionId: string;
  initial: FunctionDetailsValues;
  // Everything this function may sit under: the whole chart minus
  // itself and its own descendants, indented, computed on the
  // server where the tree is.
  parentOptions: Array<{ id: string; title: string }>;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  canEdit: boolean;
  // Fired after the save succeeded and the refresh is on its way.
  onSaved?: (values: FunctionDetailsValues) => void;
  // So a host that can be closed (the drawer) can ask before
  // throwing typed work away.
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [parentId, setParentId] = useState(initial.parentFunctionId ?? "");
  const [leadId, setLeadId] = useState(initial.leadId ?? "");
  const [pending, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-seed when the host swaps functions under us. The drawer does
  // exactly that when you click a sub-function, and without this the
  // form would keep showing the function you came from.
  useEffect(() => {
    setTitle(initial.title);
    setParentId(initial.parentFunctionId ?? "");
    setLeadId(initial.leadId ?? "");
    setError(null);
  }, [functionId, initial.title, initial.parentFunctionId, initial.leadId]);

  const dirty = useMemo(
    () =>
      title !== initial.title ||
      parentId !== (initial.parentFunctionId ?? "") ||
      leadId !== (initial.leadId ?? ""),
    [title, parentId, leadId, initial]
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
    // onDirtyChange is an inline arrow from the caller, so a new
    // identity arrives every render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // Read-only for anybody who cannot edit. A disabled form is a
  // worse way to say "this isn't yours" than simply stating it.
  if (!canEdit) {
    const parent = parentOptions.find((p) => p.id === initial.parentFunctionId);
    const lead = roster.find((p) => p.id === initial.leadId);
    return (
      <dl className={styles.fnFactList}>
        <div className={styles.fnFact}>
          <dt className={styles.fnFactLabel}>Sits under</dt>
          <dd className={styles.fnFactValue}>
            {parent ? parent.title.replace(/^[\u00a0]+/, "") : "Top level"}
          </dd>
        </div>
        <div className={styles.fnFact}>
          <dt className={styles.fnFactLabel}>In the seat</dt>
          <dd
            className={
              lead
                ? styles.fnFactValue
                : `${styles.fnFactValue} ${styles.fnSeatEmpty}`
            }
          >
            {lead?.full_name ?? "Unassigned"}
          </dd>
        </div>
      </dl>
    );
  }

  function save() {
    if (pending) return;
    const next: FunctionDetailsValues = {
      title: title.trim(),
      parentFunctionId: parentId || null,
      leadId: leadId || null,
    };
    if (!next.title) {
      setError("Give the function a name.");
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await updateFunctionDetailsAction(functionId, next);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      onSaved?.(next);
      router.refresh();
    });
  }

  return (
    <form
      className={styles.fnDetailsForm}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Name</span>
        <input
          className={styles.formInput}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          required
          aria-label="Function name"
        />
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Sits under</span>
        <select
          className={styles.formSelect}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          disabled={pending}
          aria-label="Sits under"
        >
          <option value="">Top level (no parent)</option>
          {parentOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>In the seat</span>
        <select
          className={styles.formSelect}
          value={leadId}
          onChange={(e) => setLeadId(e.target.value)}
          disabled={pending}
          aria-label="In the seat"
        >
          <option value="">Unassigned</option>
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p role="alert" className={styles.errorMessage}>
          {error}
        </p>
      ) : null}

      <div className={styles.formSubmit}>
        <button
          type="submit"
          className={uiStyles.btnPrimary}
          // Disabled until something changes, so the button reports
          // whether there is anything to save rather than inviting a
          // write that would change nothing.
          disabled={pending || !dirty}
          data-testid="save-function-details"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <ConfirmationChip visible={saved} label="Saved" />
      </div>
    </form>
  );
}
