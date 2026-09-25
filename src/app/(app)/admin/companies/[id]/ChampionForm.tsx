"use client";

import { useState, useTransition } from "react";
import { setAimsChampionAction } from "@/lib/companies/actions";
import styles from "../admin.module.css";

export type ChampionCandidate = { id: string; full_name: string };

export function ChampionForm({
  companyId,
  initial,
  candidates,
}: {
  companyId: string;
  initial: string | null;
  candidates: ChampionCandidate[];
}) {
  const [value, setValue] = useState<string>(initial ?? "");
  const [saved, setSaved] = useState<string>(initial ?? "");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const dirty = value !== saved;

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setAimsChampionAction(companyId, value || null);
      if (result.ok) {
        const next = result.company.aims_champion_profile_id ?? "";
        setSaved(next);
        setValue(next);
        setMessage({
          ok: true,
          text: next ? "AiMS champion updated." : "The seat is empty.",
        });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div className={styles.form}>
      <div className={`${styles.field} ${styles.formFull}`}>
        <label htmlFor="company-champion" className={styles.label}>
          AiMS champion
        </label>
        <select
          id="company-champion"
          className={styles.select}
          value={value}
          onChange={(e) => {
            setMessage(null);
            setValue(e.target.value);
          }}
          disabled={pending || candidates.length === 0}
        >
          <option value="">Nobody yet</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>

      {/* One sentence, in Jason's words. It names the RELATIONSHIP,
          not the mechanism: the meeting debrief is the first thing
          Aimee does for this person and will not be the last, so copy
          describing a note after each meeting would be wrong the day
          the second trigger ships. That the seat grants no access is
          said on the help page, not here. */}
      <p className={`${styles.subtitleInline} ${styles.formFull}`}>
        The AiMS Champion is the lead on implementing AiMS and the person
        who Aimee will help guide through the process.
      </p>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? styles.successMessage : styles.errorMessage}
        >
          {message.text}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={save}
          disabled={pending || !dirty}
        >
          {pending ? "Saving…" : "Save champion"}
        </button>
      </div>
    </div>
  );
}
