"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoleDescriptionOverrideAction } from "@/lib/role-descriptions/overrides-action";
import type { RdUserOverrides } from "@/lib/role-descriptions/generate";
import styles from "./role-description.module.css";

// Admin-only click-to-edit for one Strengths & Expertise sub-field.
// Two shapes:
//   - "list" — Technical / Strategic / Interpersonal. Displayed as
//     a bulleted list; edited as a textarea with one item per
//     line; saved as string[]. Restore clears the array.
//   - "single" — Ownership (accountability). Displayed as a
//     paragraph; edited as a textarea; saved as a single string.
//
// Persistence mirrors EditableQualification — patches into the
// nested strengthsAndExpertise sub-object on user_overrides, so
// edits survive regeneration.

type ListField = "technical" | "strategic" | "interpersonal";

type Props =
  | {
      functionId: string;
      kind: "list";
      field: ListField;
      items: string[];
      isOverridden: boolean;
      canEdit: boolean;
    }
  | {
      functionId: string;
      kind: "single";
      field: "accountability";
      text: string;
      isOverridden: boolean;
      canEdit: boolean;
    };

export function EditableStrength(props: Props) {
  const router = useRouter();
  const initialDraft =
    props.kind === "list" ? props.items.join("\n") : props.text;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function beginEdit() {
    setDraft(initialDraft);
    setEditing(true);
    setError(null);
  }

  function cancel() {
    setEditing(false);
    setDraft(initialDraft);
    setError(null);
  }

  function buildPatch(nextValue: string | null): RdUserOverrides {
    if (props.kind === "list") {
      const items =
        nextValue === null || nextValue.trim().length === 0
          ? []
          : nextValue
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
      return { strengthsAndExpertise: { [props.field]: items } };
    }
    return {
      strengthsAndExpertise: { accountability: nextValue ?? "" },
    };
  }

  function save() {
    if (draft.trim().length === 0) {
      setError("Empty — use Restore generated instead.");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await saveRoleDescriptionOverrideAction({
        functionId: props.functionId,
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
        functionId: props.functionId,
        patch: buildPatch(null),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  if (editing) {
    const rows =
      props.kind === "list"
        ? Math.max(4, Math.min(12, draft.split("\n").length + 1))
        : Math.max(2, Math.min(6, draft.split("\n").length + 1));
    return (
      <div className={styles.editableWrap}>
        <textarea
          className={styles.editableTextarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={rows}
          disabled={saving}
          autoFocus
          aria-label={`Edit ${props.field}`}
          placeholder={props.kind === "list" ? "One item per line" : undefined}
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
      {props.kind === "list" ? (
        props.items.length > 0 ? (
          <ul className={styles.rdSubBlockList}>
            {props.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.rdSubBlockBody}>
            <em>No items yet.</em>
          </p>
        )
      ) : props.text ? (
        <p className={styles.rdSubBlockBody}>{props.text}</p>
      ) : (
        <p className={styles.rdSubBlockBody}>
          <em>No ownership statement yet.</em>
        </p>
      )}
      {props.canEdit ? (
        <div className={styles.editableMeta}>
          <button
            type="button"
            className={styles.editableGhost}
            onClick={beginEdit}
          >
            Edit
          </button>
          {props.isOverridden ? (
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
