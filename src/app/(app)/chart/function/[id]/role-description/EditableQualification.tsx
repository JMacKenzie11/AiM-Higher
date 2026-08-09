"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoleDescriptionOverrideAction } from "@/lib/role-descriptions/overrides-action";
import styles from "./role-description.module.css";

// Admin-only click-to-edit for one Qualification sub-field on the
// RD view page (Experience, Education, or Certifications). Uses
// the same override infrastructure as EditableProseSection —
// saves are patched into role_description_documents.user_overrides
// and merged over the generated doc on next render, so edits
// survive regeneration.

type QualificationField = "experience" | "education" | "certifications";

export function EditableQualification({
  functionId,
  field,
  text,
  isOverridden,
  canEdit,
}: {
  functionId: string;
  field: QualificationField;
  text: string;
  isOverridden: boolean;
  canEdit: boolean;
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
        patch: { qualifications: { [field]: draft } },
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
        patch: { qualifications: { [field]: "" } },
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
          rows={Math.max(2, Math.min(6, draft.split("\n").length + 1))}
          disabled={saving}
          autoFocus
          aria-label={`Edit ${field}`}
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
      <p className={styles.rdSubBlockBody}>{text}</p>
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
