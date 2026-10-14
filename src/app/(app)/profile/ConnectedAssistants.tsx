"use client";

import { useState, useTransition } from "react";
import { revokeAssistantAction, type ConnectedAssistant } from "@/lib/mcp/grants";
import styles from "./profile.module.css";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// The outside assistants this person has allowed, each with a
// Disconnect that takes effect at once (Phase 4).
export function ConnectedAssistants({ initial }: { initial: ConnectedAssistant[] }) {
  const [items, setItems] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return <p className={styles.subtitleInline}>No outside assistants are connected to your account.</p>;
  }

  function revoke(a: ConnectedAssistant) {
    if (!window.confirm(`Disconnect ${a.name}? It stops reaching AiMS at once. You can connect it again later.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await revokeAssistantAction(a.clientId);
      if (result.ok) setItems((xs) => xs.filter((x) => x.clientId !== a.clientId));
      else setError(result.message ?? "Couldn't disconnect that assistant.");
    });
  }

  return (
    <>
      <ul className={styles.assistantList}>
        {items.map((a) => (
          <li key={a.clientId} className={styles.assistantItem}>
            <div>
              <p className={styles.assistantName}>{a.name}</p>
              <p className={styles.assistantMeta}>
                Connected {when(a.connectedAt)}
                {" · "}
                {a.lastUsedAt
                  ? `last used ${when(a.lastUsedAt)}, ${a.callsLast30Days} ${a.callsLast30Days === 1 ? "request" : "requests"} in 30 days`
                  : "not used in the last 30 days"}
              </p>
            </div>
            <button type="button" className={styles.assistantRevoke} onClick={() => revoke(a)} disabled={pending}>
              Disconnect
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className={styles.assistantError}>
          {error}
        </p>
      ) : null}
    </>
  );
}
