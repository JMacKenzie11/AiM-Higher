"use client";

import { useState, useTransition } from "react";
import { setPracticePartnerAction } from "@/lib/practices/actions";
import type { Practice } from "@/lib/practices/registry";
import styles from "./practice.module.css";

// Empty-state setup shown at the top of a fresh practice conversation.
// Optional person picker (scoped to the caller's active company
// roster; caller excluded), then the practice's opening chips, then
// the standard composer (owned by ChatView) picks up from here. If
// there are no eligible roster options, the picker collapses to a
// muted note; the practice still runs, just without partner context.

export type RosterOption = {
  id: string;
  full_name: string;
  position: string | null;
};

export function PracticeSetup({
  conversationId,
  practice,
  roster,
  initialPartnerId,
  onSendChip,
  disabled,
}: {
  conversationId: string;
  practice: Practice;
  roster: readonly RosterOption[];
  initialPartnerId: string | null;
  onSendChip: (chip: string) => void;
  disabled: boolean;
}) {
  const [partnerId, setPartnerId] = useState<string | null>(initialPartnerId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function updatePartner(next: string | null) {
    setError(null);
    setPartnerId(next);
    startTransition(async () => {
      const result = await setPracticePartnerAction(conversationId, next);
      if (!result.ok) {
        setError(result.message);
        // Roll the local state back so the picker matches server state.
        setPartnerId(initialPartnerId);
      }
    });
  }

  return (
    <div className={styles.setup}>
      <div>
        <p className={styles.setupEyebrow}>Practice</p>
        <h2 className={styles.setupTitle}>{practice.title}</h2>
        <p className={styles.setupDescription}>{practice.description}</p>
      </div>

      <div className={styles.setupField}>
        <label htmlFor="practice-partner" className={styles.setupLabel}>
          Who is this about? (optional)
        </label>
        {roster.length === 0 ? (
          <p className={styles.setupDescription}>
            No one else on your roster yet. That&rsquo;s fine, the practice
            still runs.
          </p>
        ) : (
          <select
            id="practice-partner"
            className={styles.setupSelect}
            value={partnerId ?? ""}
            disabled={pending || disabled}
            onChange={(e) =>
              updatePartner(e.target.value === "" ? null : e.target.value)
            }
          >
            <option value="">Not saying yet</option>
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
                {r.position ? ` · ${r.position}` : ""}
              </option>
            ))}
          </select>
        )}
        {error ? (
          <p className={styles.setupError} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {practice.chips && practice.chips.length > 0 ? (
        <div className={styles.setupField}>
          <span className={styles.setupLabel}>Start with</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {practice.chips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onSendChip(chip)}
                disabled={disabled}
                className={styles.card}
                style={{
                  padding: "8px 14px",
                  fontSize: 14,
                  boxShadow: "none",
                }}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
