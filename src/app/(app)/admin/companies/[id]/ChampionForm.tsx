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

      {/* The help line, which is the whole explanation this control
          needs.

          It names the RELATIONSHIP, not the mechanism. The meeting
          debrief is the first thing Aimee does for this person and
          it will not be the last; copy that defined the seat as
          "gets a note after a meeting" would be wrong the day the
          second trigger ships, while reading — to the person who
          holds it — like the whole job.

          The second sentence stays whatever else changes. Somebody
          reading "champion" next to a person picker will assume it
          grants something unless told plainly that it does not. */}
      <p className={styles.subtitleInline}>
        This is the person who will lead your implementation of AiMS, and
        who Aimee will coach through the process. Today that starts after
        each leadership meeting is summarised, with a note in their
        notification bar inviting them to talk it through.
      </p>
      <p className={styles.subtitleInline}>
        It changes nothing else: the seat grants no access, and anyone who
        could already see this company&rsquo;s work still can.
      </p>

      {saved === "" ? (
        <p role="status" className={styles.subtitleInline}>
          With nobody in the seat, Aimee has no one to work with here
          and those notes are not sent.
        </p>
      ) : null}

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
