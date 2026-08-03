"use client";

import { useState, useTransition } from "react";
import {
  assignGuideAction,
  deleteGuideAction,
  unassignGuideAction,
} from "@/lib/admin/guides-actions";
import type { Company } from "@/lib/types";
import styles from "./admin.module.css";

// Row-level actions for one guide on the AiMS Guides card:
//   - Assign to another company (dropdown of unassigned companies).
//   - Unassign from a specific company (chip-style buttons).
//   - Delete the guide entirely.
// Server-side rules keep at least one assignment per guide.

export function GuideRowActions({
  guideId,
  assignedCompanyIds,
  allCompanies,
}: {
  guideId: string;
  assignedCompanyIds: string[];
  allCompanies: Pick<Company, "id" | "name">[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [pickCompanyId, setPickCompanyId] = useState<string>("");

  const availableToAssign = allCompanies.filter(
    (c) => !assignedCompanyIds.includes(c.id)
  );

  function run(fn: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setMsg(r.message);
    });
  }

  return (
    <div className={styles.actionsCell}>
      {availableToAssign.length > 0 ? (
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
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

      {assignedCompanyIds.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            flexWrap: "wrap",
          }}
        >
          {assignedCompanyIds.map((cid) => {
            const c = allCompanies.find((x) => x.id === cid);
            if (!c) return null;
            return (
              <button
                key={cid}
                type="button"
                className={styles.ghostButton}
                disabled={pending}
                title={`Unassign from ${c.name}`}
                onClick={() => {
                  if (
                    !confirm(
                      `Unassign this guide from ${c.name}? They'll lose access to the company.`
                    )
                  )
                    return;
                  run(() => unassignGuideAction(guideId, cid));
                }}
              >
                {c.name} ×
              </button>
            );
          })}
        </div>
      ) : null}

      <button
        type="button"
        className={styles.dangerButton}
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              "Delete this guide? They'll be removed from the platform entirely."
            )
          )
            return;
          run(() => deleteGuideAction(guideId));
        }}
      >
        Delete guide
      </button>

      {msg ? <p className={styles.inlineError}>{msg}</p> : null}
    </div>
  );
}
