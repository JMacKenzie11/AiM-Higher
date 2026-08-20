"use client";

import { useState, useTransition } from "react";
import { unassignGuideAction } from "@/lib/admin/guides-actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Company } from "@/lib/types";
import styles from "./admin.module.css";

// Companies-column contents for one guide row: the currently-assigned
// company chips (each with × to unassign). The "Assign to…" picker
// lives in its own column (GuideAssignCell) so the row lays out
// predictably even when a guide coaches many companies.

export function GuideCompaniesCell({
  guideId,
  assignments,
}: {
  guideId: string;
  assignments: Array<{ company_id: string; company_name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [pendingUnassign, setPendingUnassign] = useState<
    Pick<Company, "id" | "name"> | null
  >(null);

  return (
    <div className={styles.guideCompaniesCell}>
      {assignments.length === 0 ? (
        <span className={styles.mutedCell}>
          (no assignments — will be prompted to pick one on sign-in)
        </span>
      ) : (
        <div className={styles.guideCompanyChips}>
          {assignments.map((a) => {
            // Split the trailing word off so we can glue it to the ×
            // in a single white-space: nowrap unit. Without this the
            // × drops onto its own line for multi-word names like
            // "Centre North Physiotherapy Clinic" and reads as a
            // stray glyph.
            const words = a.company_name.split(" ");
            const lastWord = words[words.length - 1] ?? "";
            const leading = words.length > 1 ? words.slice(0, -1).join(" ") + " " : "";
            return (
              <button
                key={a.company_id}
                type="button"
                className={styles.ghostButton}
                disabled={pending}
                title={`Unassign from ${a.company_name}`}
                onClick={() =>
                  setPendingUnassign({ id: a.company_id, name: a.company_name })
                }
              >
                {leading}
                <span className={styles.chipTail}>
                  {lastWord}
                  {"\u00a0"}
                  <span className={styles.chipClose} aria-hidden="true">
                    ×
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {msg ? <p className={styles.inlineError}>{msg}</p> : null}

      <ConfirmDialog
        open={pendingUnassign !== null}
        title={
          pendingUnassign
            ? `Unassign from ${pendingUnassign.name}?`
            : "Unassign?"
        }
        message="This guide will lose access to the company. Re-assign later from this same panel if it's a temporary rotation."
        confirmLabel="Unassign"
        tone="danger"
        onConfirm={() => {
          if (!pendingUnassign) return;
          const cid = pendingUnassign.id;
          setPendingUnassign(null);
          setMsg(null);
          startTransition(async () => {
            const r = await unassignGuideAction(guideId, cid);
            if (!r.ok) setMsg(r.message);
          });
        }}
        onCancel={() => setPendingUnassign(null)}
        pending={pending}
      />
    </div>
  );
}
