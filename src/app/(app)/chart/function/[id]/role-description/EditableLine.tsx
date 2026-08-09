"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoleDescriptionOverrideAction } from "@/lib/role-descriptions/overrides-action";
import type { RdUserOverrides } from "@/lib/role-descriptions/generate";
import styles from "./role-description.module.css";

// Small click-to-edit primitive shared by every RD editable line
// that isn't the two big prose sections. Renders text (or a
// newline list for kind="lines") with an Edit affordance
// underneath; switches to a textarea + Save/Cancel on click; shows
// an "Edited — Restore generated" pill when the value came from
// an override.
//
// Server callers pass a *serializable* PatchSpec describing where
// the edit should be written. This module owns the translation
// from (spec, textareaValue) → RdUserOverrides patch, so server
// components don't have to hand across closures — which would
// trip Next.js's "Functions cannot be passed directly to Client
// Components" boundary.

export type PatchSpec =
  | { kind: "positionSummary" }
  | { kind: "whyThisRoleMatters" }
  | {
      kind: "outcomeEnrichment";
      matchTitle: string;
      field: "whyItMatters" | "valuesConnection";
    }
  | { kind: "responsibilityEnrichment"; matchTitle: string }
  | { kind: "strengthList"; field: "technical" | "strategic" | "interpersonal" }
  | { kind: "strengthAccountability" }
  | {
      kind: "qualification";
      field: "experience" | "education" | "certifications";
    };

type LineKind = "paragraph" | "lines";

export function EditableLine({
  functionId,
  text,
  isOverridden,
  canEdit,
  kind = "paragraph",
  labelKind,
  spec,
}: {
  functionId: string;
  text: string;
  isOverridden: boolean;
  canEdit: boolean;
  kind?: LineKind;
  labelKind: string;
  spec: PatchSpec;
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
        patch: buildPatch(spec, draft),
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
        patch: buildPatch(spec, ""),
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

// Translate a PatchSpec + user-entered text into an RdUserOverrides
// patch shape the server action understands. Kept client-side so
// server components hand across only plain data.
function buildPatch(spec: PatchSpec, text: string): RdUserOverrides {
  const trimmed = text.trim();
  switch (spec.kind) {
    case "positionSummary":
      return { positionSummary: trimmed };
    case "whyThisRoleMatters":
      return { whyThisRoleMatters: trimmed };
    case "outcomeEnrichment":
      return {
        outcomeEnrichments: [
          spec.field === "whyItMatters"
            ? { matchTitle: spec.matchTitle, whyItMatters: trimmed }
            : { matchTitle: spec.matchTitle, valuesConnection: trimmed },
        ],
      };
    case "responsibilityEnrichment":
      return {
        responsibilityEnrichments: [
          { matchTitle: spec.matchTitle, strategicContext: trimmed },
        ],
      };
    case "strengthList": {
      const items =
        trimmed.length === 0
          ? []
          : trimmed
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
      return { strengthsAndExpertise: { [spec.field]: items } };
    }
    case "strengthAccountability":
      return { strengthsAndExpertise: { accountability: trimmed } };
    case "qualification":
      return { qualifications: { [spec.field]: trimmed } };
  }
}
