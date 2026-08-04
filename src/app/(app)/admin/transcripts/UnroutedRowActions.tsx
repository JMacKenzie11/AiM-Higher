"use client";

import { useState, useTransition } from "react";
import {
  routeMeetingAction,
  dismissMeetingAction,
} from "@/lib/transcripts/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Company } from "@/lib/types";
import styles from "../companies/admin.module.css";

export function UnroutedRowActions({
  meetingId,
  companies,
}: {
  meetingId: string;
  companies: Pick<Company, "id" | "name">[];
}) {
  const [companyId, setCompanyId] = useState<string>(companies[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);

  function route(analyze: boolean) {
    if (!companyId) {
      setMsg("Pick a company.");
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await routeMeetingAction(meetingId, companyId, analyze);
      if (!r.ok) setMsg(r.message);
    });
  }

  function runDismiss() {
    setConfirmDismiss(false);
    setMsg(null);
    startTransition(async () => {
      const r = await dismissMeetingAction(meetingId);
      if (!r.ok) setMsg(r.message);
    });
  }

  return (
    <div className={styles.actionsCell} style={{ flexDirection: "column", alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <select
          className={styles.select}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          disabled={pending}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => route(false)}
          disabled={pending}
        >
          Assign
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => route(true)}
          disabled={pending}
        >
          {pending ? "Working…" : "Route + analyze"}
        </button>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={() => setConfirmDismiss(true)}
          disabled={pending}
        >
          Dismiss
        </button>
      </div>
      {msg ? <p className={styles.inlineError}>{msg}</p> : null}
      <ConfirmDialog
        open={confirmDismiss}
        title="Dismiss this file as not a transcript?"
        message="It disappears from the unrouted queue. You can re-ingest by dropping the file back into the source folder."
        confirmLabel="Dismiss"
        tone="danger"
        onConfirm={runDismiss}
        onCancel={() => setConfirmDismiss(false)}
        pending={pending}
      />
    </div>
  );
}
