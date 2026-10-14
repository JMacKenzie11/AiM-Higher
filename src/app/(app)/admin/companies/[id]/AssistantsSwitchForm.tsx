"use client";

import { useState, useTransition } from "react";
import { setCompanyAssistantsAction } from "@/lib/companies/actions";
import { HowToConnectButton } from "@/components/ai-apps/ConnectAiAppsDrawer";
import styles from "../admin.module.css";

// The company's own switch for outside assistants (0279). On by
// default since 0284: while it is off, no assistant may read or add
// anything for this company, whoever asks.
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
        setMessage({ ok: true, text: on ? "AI apps are on." : "AI apps are off." });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div className={styles.form}>
      <p className={`${styles.formFull} ${styles.subtitleInline}`}>
        When this is on, people at {companyName} can connect an AI app, such as Claude or ChatGPT,
        to read their AiMS work and add commitments, issues and measure values for them, as
        themselves. Each person still chooses whether to connect one. This is on by default, and
        you can switch it off at any time. AiMS never lets your data be used to train AI models.
        Once it reaches the AI app, that app&apos;s terms and privacy policy apply instead, along
        with your own settings there.
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
        Let people at {companyName} use AiMS HQ in AI apps like Claude and ChatGPT
      </label>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? styles.successMessage : styles.errorMessage}>
          {message.text}
        </p>
      ) : null}
      <div className={styles.submitRow}>
        <HowToConnectButton />
        <button type="button" className={styles.primaryButton} onClick={save} disabled={pending || on === saved}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
