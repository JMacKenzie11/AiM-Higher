"use client";

import { useState } from "react";
import { saveAgentTeamAction } from "@/lib/diagnostics/actions";
import type { AgentCard } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// THE RECOMMENDED AGENT TEAM on Build (0309). Starts from the
// suggestion (lib/diagnostics/agents.ts: the candidates by agent type,
// most hours first); every card can be edited, removed or added to, and
// Save keeps the team as edited. "Back to the suggestion" clears the
// edits. The readout shows whichever is current.

const FIELDS: Array<{ key: keyof Omit<AgentCard, "agentType">; label: string; multiline?: boolean; placeholder?: string }> = [
  { key: "name", label: "Agent name" },
  { key: "role", label: "Role, in one line" },
  { key: "routine", label: "Routine: what it does and when", multiline: true, placeholder: "Weekdays at 7:00 am: match supplier invoices to purchase orders" },
  { key: "connectors", label: "Connects to", placeholder: "Outlook, Acumatica" },
  { key: "limits", label: "Limits", multiline: true },
];

export function AgentTeam({
  diagnosticId,
  saved,
  suggested,
  defaultLimits,
}: {
  diagnosticId: string;
  saved: AgentCard[] | null;
  suggested: AgentCard[];
  defaultLimits: string;
}) {
  const edited = Boolean(saved && saved.length);
  const [cards, setCards] = useState<AgentCard[]>(edited ? saved! : suggested);
  const [dirty, setDirty] = useState(false);
  const { pending, error, saved: justSaved, run } = useDxAction();

  const set = (i: number, k: keyof AgentCard, v: string) => {
    setCards((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
    setDirty(true);
  };

  return (
    <div className={styles.body}>
      <p className={styles.status}>
        {edited
          ? "Your edited team. The readout shows it after Top 3 Next Wins."
          : suggested.length
            ? "Suggested from the candidates' agent types, most hours a week first. Edit any card and save to keep it."
            : "Score each task's agent type on Pre-flight and a team is suggested here. Or add an agent by hand."}
      </p>
      {cards.map((c, i) => (
        <fieldset key={i} className={styles.agentCard}>
          <legend className={styles.cardTitle}>{c.name || `Agent ${i + 1}`}</legend>
          <div className={styles.grid2}>
            {FIELDS.map((f) => (
              <div key={f.key} className={admin.field}>
                <label className={admin.label} htmlFor={`agent-${i}-${f.key}`}>
                  {f.label}
                </label>
                {f.multiline ? (
                  <textarea
                    id={`agent-${i}-${f.key}`}
                    className={styles.textarea}
                    value={c[f.key]}
                    placeholder={f.placeholder}
                    maxLength={500}
                    onChange={(e) => set(i, f.key, e.target.value)}
                  />
                ) : (
                  <input
                    id={`agent-${i}-${f.key}`}
                    className={admin.input}
                    value={c[f.key]}
                    placeholder={f.placeholder}
                    maxLength={f.key === "name" ? 120 : 300}
                    onChange={(e) => set(i, f.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className={`${styles.secondary} ${styles.small}`}
            onClick={() => {
              setCards((cs) => cs.filter((_, j) => j !== i));
              setDirty(true);
            }}
          >
            Remove {c.name || "this agent"}
          </button>
        </fieldset>
      ))}
      <div className={styles.formRow}>
        {cards.length < 6 ? (
          <button
            type="button"
            className={`${styles.secondary} ${styles.small}`}
            onClick={() => {
              setCards((cs) => [...cs, { agentType: null, name: "", role: "", routine: "", connectors: "", limits: defaultLimits }]);
              setDirty(true);
            }}
          >
            Add an agent
          </button>
        ) : null}
        <button
          type="button"
          className={`${styles.primary} ${styles.small}`}
          disabled={pending || !dirty}
          onClick={() => run(() => saveAgentTeamAction(diagnosticId, cards), () => setDirty(false))}
        >
          Save the team
        </button>
        {edited ? (
          <button
            type="button"
            className={`${styles.secondary} ${styles.small}`}
            disabled={pending}
            onClick={() =>
              run(
                () => saveAgentTeamAction(diagnosticId, []),
                () => {
                  setCards(suggested);
                  setDirty(false);
                }
              )
            }
          >
            Back to the suggestion
          </button>
        ) : null}
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : pending ? (
          <span className={styles.status}>Saving…</span>
        ) : dirty ? (
          <span className={styles.status}>Unsaved changes</span>
        ) : justSaved ? (
          <span className={styles.status}>Saved</span>
        ) : null}
      </div>
    </div>
  );
}
