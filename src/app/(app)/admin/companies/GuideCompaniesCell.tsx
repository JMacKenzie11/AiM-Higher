"use client";

import { useState, useTransition } from "react";
import {
  assignGuideAction,
  unassignGuideAction,
} from "@/lib/admin/guides-actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Company } from "@/lib/types";
import styles from "./admin.module.css";

// Companies-column contents for one guide row: the currently-assigned
// company chips (each with × to unassign), plus an inline "Assign
// to…" picker for adding another. Split out from the row's Actions
// cell so account-level actions (⋯ menu) can live on their own and
// the row lays out predictably.

export function GuideCompaniesCell({
  guideId,
  assignments,
  allCompanies,
}: {
  guideId: string;
  assignments: Array<{ company_id: string; company_name: string }>;
  allCompanies: Pick<Company, "id" | "name">[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [pickCompanyId, setPickCompanyId] = useState<string>("");
  const [pendingUnassign, setPendingUnassign] = useState<
    Pick<Company, "id" | "name"> | null
  >(null);

  const assignedIds = assignments.map((a) => a.company_id);
  const availableToAssign = allCompanies.filter(
    (c) => !assignedIds.includes(c.id)
  );

  function run(fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setMsg(r.message);
    });
  }

  return (
    <div className={styles.guideCompaniesCell}>
      {assignments.length === 0 ? (
        <span className={styles.mutedCell}>
          (no assignments — will be prompted to pick one on sign-in)
        </span>
      ) : (
        <div className={styles.guideCompanyChips}>
          {assignments.map((a) => (
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
              {a.company_name} ×
            </button>
          ))}
        </div>
      )}

      {availableToAssign.length > 0 ? (
        <div className={styles.guideAssignRow}>
          <select
            value={pickCompanyId}
            onChange={(e) => setPickCompanyId(e.target.value)}
            disabled={pending}
            className={styles.select}
          >
            <option value="">Assign to…</option>
            {availableToAssign.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={pending || !pickCompanyId}
            onClick={() => {
              const target = pickCompanyId;
              if (!target) return;
              setPickCompanyId("");
              run(() => assignGuideAction(guideId, target));
            }}
          >
            Assign
          </button>
        </div>
      ) : null}

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
          run(() => unassignGuideAction(guideId, cid));
        }}
        onCancel={() => setPendingUnassign(null)}
        pending={pending}
      />
    </div>
  );
}
