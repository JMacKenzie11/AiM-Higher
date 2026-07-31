"use client";

import { useState, useTransition } from "react";
import {
  createAliasAction,
  deleteAliasAction,
} from "@/lib/transcripts/actions";
import type { TranscriptAlias } from "@/lib/types";
import styles from "../admin.module.css";

// Manages the list of filename aliases that route shared-folder
// transcripts to this company. Global-unique on lower(alias) — the
// server surfaces the conflict as an error message inline.

export function AliasEditor({
  companyId,
  aliases,
}: {
  companyId: string;
  aliases: TranscriptAlias[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    const fd = new FormData();
    fd.set("company_id", companyId);
    fd.set("alias", trimmed);
    setMsg(null);
    startTransition(async () => {
      const r = await createAliasAction(fd);
      if (!r.ok) setMsg(r.message);
      else setDraft("");
    });
  }

  function remove(aliasId: string) {
    if (!confirm("Remove this alias?")) return;
    setMsg(null);
    startTransition(async () => {
      const r = await deleteAliasAction(aliasId);
      if (!r.ok) setMsg(r.message);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {aliases.length === 0 ? (
        <p className={styles.emptyLine}>No aliases yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {aliases.map((a) => (
            <li
              key={a.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "4px 12px",
                background: "var(--aims-navy-tint)",
                borderRadius: "var(--radius-pill)",
                font: "var(--text-body-sm)",
              }}
            >
              <span>{a.alias}</span>
              <button
                type="button"
                onClick={() => remove(a.id)}
                disabled={pending}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--aims-danger)",
                  fontSize: "16px",
                  lineHeight: 1,
                  padding: 0,
                }}
                aria-label={`Remove alias ${a.alias}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} style={{ display: "flex", gap: "var(--space-2)" }}>
        <input
          type="text"
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add an alias (matched case-insensitively in file names)"
          disabled={pending}
          style={{ flex: "1 1 auto" }}
        />
        <button
          type="submit"
          className={styles.ghostButton}
          disabled={pending || !draft.trim()}
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {msg ? <p className={styles.inlineError}>{msg}</p> : null}
    </div>
  );
}
