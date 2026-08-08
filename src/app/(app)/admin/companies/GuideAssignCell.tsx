"use client";

import { useState, useTransition } from "react";
import { assignGuideAction } from "@/lib/admin/guides-actions";
import type { Company } from "@/lib/types";
import styles from "./admin.module.css";

// Assign-To column for one guide row: dropdown of companies the guide
// isn't already assigned to, plus an Assign button. Split out from
// GuideCompaniesCell so the assignment picker gets its own column.

export function GuideAssignCell({
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

  const assignedIds = assignments.map((a) => a.company_id);
  const availableToAssign = allCompanies.filter(
    (c) => !assignedIds.includes(c.id)
  );

  if (availableToAssign.length === 0) {
    return <span className={styles.mutedCell}>—</span>;
  }

  return (
    <div className={styles.guideCompaniesCell}>
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
            setMsg(null);
            startTransition(async () => {
              const r = await assignGuideAction(guideId, target);
              if (!r.ok) setMsg(r.message);
            });
          }}
        >
          Assign
        </button>
      </div>

      {msg ? <p className={styles.inlineError}>{msg}</p> : null}
    </div>
  );
}
