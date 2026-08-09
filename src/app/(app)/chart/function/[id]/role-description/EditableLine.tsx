"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoleDescriptionOverrideAction } from "@/lib/role-descriptions/overrides-action";
import type { RdUserOverrides } from "@/lib/role-descriptions/generate";
import styles from "./role-description.module.css";

// Small click-to-edit primitive shared by every RD editable line
// that isn't the two big prose sections. Renders a paragraph (or
// list, when kind=lines) with an Edit affordance underneath;
// switches to a textarea + Save/Cancel on click; shows an "Edited
// — Restore generated" pill when the value came from an override.
//
// Caller supplies the two things unique to their spot:
//   1. buildPatch(nextText) — how to shape the RdUserOverrides
//      patch when the user hits Save (identifies the field this
//      editor writes to; for enrichment arrays, includes matchTitle).
//   2. buildRestorePatch() — the shape of the patch that clears
//      just this field (usually the same buildPatch called with
//      an empty string).

type Kind = "paragraph" | "lines";

export function EditableLine({
  functionId,
  text,
  isOverridden,
  canEdit,
  kind = "paragraph",
  labelKind,
  buildPatch,
  buildRestorePatch,
}: {
  functionId: string;
  text: string;
  isOverridden: boolean;
  canEdit: boolean;
  kind?: Kind;
  labelKind: string; // used in aria-labels: "why it matters", "strategic context", etc.
  buildPatch: (nextText: string) => RdUserOverrides;
  buildRestorePatch: () => RdUserOverrides;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function beginEdit() {
    setDraft(text);
    setEditing(true);
    setError(null);
  }

  function cancel() {
    setEditing(false);
    setDraft(text);
    setError(null);
  }

  function save() {
    if (draft.trim().length === 0) {
      setError("Empty — use Restore generated instead.");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await saveRoleDescriptionOverrideAction({
        functionId,
        patch: buildPatch(draft),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function restore() {
    setError(null);
    startSave(async () => {
      const result = await saveRoleDescriptionOverrideAction({
        functionId,
        patch: buildRestorePatch(),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className={styles.editableWrap}>
        <textarea
          className={styles.editableTextarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={kind === "lines" ? Math.max(4, draft.split("\n").length + 1) : 3}
          disabled={saving}
          autoFocus
          aria-label={`Edit ${labelKind}`}
          placeholder={
            kind === "lines" ? "One item per line" : undefined
          }
        />
        {error ? (
          <p role="alert" className={styles.editableError}>
            {error}
          </p>
        ) : null}
        <div className={styles.editableActions}>
          <button
            type="button"
            className={styles.editablePrimary}
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className={styles.editableGhost}
            onClick={cancel}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.editableWrap}>
      <div className={styles.editableRead}>{text}</div>
      {canEdit ? (
        <div className={styles.editableMeta}>
          <button
            type="button"
            className={styles.editableGhost}
            onClick={beginEdit}
          >
            Edit
          </button>
          {isOverridden ? (
            <>
              <span className={styles.editableEditedLabel}>Edited</span>
              <button
                type="button"
                className={styles.editableGhost}
                onClick={restore}
                disabled={saving}
              >
                {saving ? "…" : "Restore generated"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
