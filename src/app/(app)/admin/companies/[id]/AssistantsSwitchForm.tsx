"use client";

import { useState, useTransition } from "react";
import { setCompanyAssistantsAction } from "@/lib/companies/actions";
import styles from "../admin.module.css";

// The company's own switch for outside assistants (0279). Off by
// default: while it is off, no assistant may read or add anything for
// this company, whoever asks.
export function AssistantsSwitchForm({
  companyId,
  companyName,
  initial,
}: {
  companyId: string;
  companyName: string;
  initial: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setCompanyAssistantsAction(companyId, on);
      if (result.ok) {
        setSaved(on);
        setMessage({ ok: true, text: on ? "Outside assistants are on." : "Outside assistants are off." });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div className={styles.form}>
      <p className={`${styles.formFull} ${styles.subtitleInline}`}>
        When this is on, people at {companyName} can connect an outside assistant, such as Claude or
        ChatGPT, to read their AiMS work and add commitments, issues and measure values for them, as
        themselves. Each person still chooses whether to connect one. Once AiMS data reaches an
        assistant, that assistant company&apos;s terms and privacy policy apply to it, not ours.
      </p>
      <label className={`${styles.checkOption} ${styles.formFull}`}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setMessage(null);
            setOn(e.target.checked);
          }}
          disabled={pending}
        />
        Allow outside assistants for {companyName}
      </label>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? styles.successMessage : styles.errorMessage}>
          {message.text}
        </p>
      ) : null}
      <div className={styles.submitRow}>
        <button type="button" className={styles.primaryButton} onClick={save} disabled={pending || on === saved}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
