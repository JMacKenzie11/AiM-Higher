"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoleDescriptionOverrideAction } from "@/lib/role-descriptions/overrides-action";
import { RichText } from "./RichText";
import styles from "./role-description.module.css";

type ProseField = "positionSummary" | "whyThisRoleMatters";

// Click-to-edit wrapper for a prose section of the RD (Position
// Summary + Why This Role Matters in v1). Renders the current
// merged text in read mode; Edit switches to a textarea; Save
// posts to saveRoleDescriptionOverrideAction and refreshes the
// page so the merged view catches up.
//
// Shows an "Edited — Restore generated" pill under the section
// when the current text came from the user override (as opposed
// to the raw model output). Restore clears the override for that
// field.

export function EditableProseSection({
  functionId,
  field,
  text,
  isOverridden,
  canEdit,
  coreValues,
}: {
  functionId: string;
  field: ProseField;
  text: string;
  isOverridden: boolean;
  canEdit: boolean;
  coreValues: readonly string[];
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
      setError("Can't save an empty section. Use Restore generated instead.");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await saveRoleDescriptionOverrideAction({
        functionId,
        patch: { [field]: draft },
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
        patch: { [field]: "" },
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
          rows={Math.max(4, Math.min(20, draft.split("\n").length + 2))}
          disabled={saving}
          autoFocus
          aria-label="Edit section text"
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
      <Paragraphs text={text} bold={coreValues} />
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

function Paragraphs({
  text,
  bold,
}: {
  text: string;
  bold: readonly string[];
}) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className={styles.rdSectionBody}>
          <RichText text={p} bold={bold} />
        </p>
      ))}
    </>
  );
}
