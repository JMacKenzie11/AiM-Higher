"use client";

import { useState, useTransition } from "react";
import { saveHubSpotKeyAction } from "@/lib/connections/actions";
import styles from "../../admin.module.css";

// Paste a HubSpot service key. It is checked with HubSpot before it is
// saved, and a key HubSpot refuses is never stored. The field is
// cleared whatever happens, so a key does not sit in the page.
export function HubSpotKeyForm({ companyId, replacing }: { companyId: string; replacing: boolean }) {
  const [key, setKey] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const id = replacing ? "hubspot-key-replace" : "hubspot-key";

  function save() {
    setMessage(null);
    const value = key;
    setKey("");
    startTransition(async () => {
      const result = await saveHubSpotKeyAction(companyId, value);
      setMessage({ ok: result.ok, text: result.message });
    });
  }

  return (
    <div className={styles.form}>
      <div className={`${styles.field} ${styles.formFull}`}>
        <label htmlFor={id} className={styles.label}>
          {replacing ? "Replace the key" : "HubSpot service key"}
        </label>
        <input
          id={id}
          className={styles.input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => {
            setMessage(null);
            setKey(e.target.value);
          }}
          disabled={pending}
        />
        <p className={styles.fieldHint}>
          In HubSpot, a Super Admin creates a service key under Settings → Integrations → Service keys, with two
          read-only scopes: crm.objects.deals.read and crm.schemas.deals.read. Paste it here yourself. Never send a key
          by email or in a chat, to AiMS or anyone else.
        </p>
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? styles.successMessage : styles.errorMessage}>
          {message.text}
        </p>
      ) : null}
      <div>
        <button type="button" className={styles.primaryButton} onClick={save} disabled={pending || !key.trim()}>
          {pending ? "Checking with HubSpot…" : replacing ? "Replace key" : "Save key"}
        </button>
      </div>
    </div>
  );
}
