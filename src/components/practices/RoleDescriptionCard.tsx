"use client";

import { useState, useTransition } from "react";
import {
  parseRoleDescription,
  roleDescriptionToPlainText,
} from "@/lib/role-descriptions/parse-document";
import { saveRoleDescriptionAction } from "@/lib/role-descriptions/save-action";
import { RoleDescriptionView } from "@/components/role-descriptions/RoleDescriptionView";
import styles from "./RoleDescriptionCard.module.css";

// Renders a role_description fenced block from the Role Description
// Builder, with Save, Download and Copy.
//
// Follows ChartProposalCard, including the malformed-JSON fallback
// and its "Fix the proposal" nudge: same failure, same remedy, and
// a leader who has met one should not have to learn the other.
//
// Three decisions the card carries:
//
//   * THE DOCUMENT IS DRAWN BY RoleDescriptionView, which also draws
//     the saved page. A preview assembled by different code from the
//     thing it previews eventually shows something the saved page
//     does not, and the leader finds out after they have sent it on.
//
//   * DOWNLOAD AND COPY WORK BEFORE SAVE. A leader who wants the
//     file and not the record should not have to create the record
//     to get the file; making them would turn Save into something
//     pressed for the wrong reason.
//
//   * THE DONE STATE IS SCOPED TO THIS CARD. A revision in
//     conversation produces a fresh block, a fresh card and a fresh
//     Save. Nothing is overwritten and nothing is global: saving
//     twice is two versions, which is the point of versions.

// Names the fields, because the failure this recovers from is
// always a field-name miss rather than broken JSON: the model
// emitted `title` for `category`, `behavior` for `behaviour` and a
// bare string for `function`. A nudge that just says "try again"
// gets the same guesses back.
const ROLE_DESCRIPTION_FIX_NUDGE =
  "Please re-emit the role_description fenced block using the exact field names from the schema: `function` as an object with `id` and `title` taken from list_functions (or null), `responsibilities` with `category` and `description`, `decision_rights` with `decides`, `decides_with` and `recommends`, and `what_excellence_looks_like` with `value` and `behaviour`. JSON only, nothing else in the block.";

export function RoleDescriptionCard({
  raw,
  streaming,
  conversationId,
  onFixRequest,
}: {
  raw: string;
  streaming: boolean;
  conversationId: string;
  onFixRequest?: (nudge: string) => void;
}) {
  const [saved, setSaved] = useState<{ versionNumber: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [downloading, setDownloading] = useState(false);

  // While the block is still streaming the JSON is a prefix of
  // itself, so parsing is guaranteed to fail and a "Fix the
  // proposal" nudge mid-stream would be noise about a document that
  // is still arriving.
  const doc = streaming ? null : parseRoleDescription(raw);

  if (streaming) {
    return (
      <div className={styles.card} data-testid="role-description-card">
        <p className={styles.building} role="status" aria-live="polite">
          Assembling the role description…
        </p>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className={styles.card} data-testid="role-description-card">
        <p className={styles.malformed}>
          That role description didn&rsquo;t come back in a shape this card can
          read.
        </p>
        {onFixRequest ? (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => onFixRequest(ROLE_DESCRIPTION_FIX_NUDGE)}
          >
            Fix the proposal
          </button>
        ) : null}
      </div>
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveRoleDescriptionAction(raw, conversationId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved({ versionNumber: result.versionNumber });
    });
  }

  async function download() {
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch("/api/role-descriptions/export.docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: raw, conversationId }),
      });
      if (!res.ok) {
        setError("Couldn't build that document.");
        return;
      }
      // Object URL rather than navigating: a navigation to a POST
      // result is not a thing, and an <a download> to a GET would
      // mean putting the whole document in a query string.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc!.title || "role-description"}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't build that document.");
    } finally {
      setDownloading(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(roleDescriptionToPlainText(doc!));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy that.");
    }
  }

  return (
    <div className={styles.card} data-testid="role-description-card">
      <RoleDescriptionView doc={doc} />

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      <div className={styles.actions}>
        {saved ? (
          <span className={styles.savedNote} role="status">
            Saved as version {saved.versionNumber}
          </span>
        ) : (
          <button
            type="button"
            className={styles.primary}
            onClick={save}
            disabled={pending}
            data-testid="save-role-description"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        )}
        <button
          type="button"
          className={styles.secondary}
          onClick={download}
          disabled={downloading}
        >
          {downloading ? "Building…" : "Download"}
        </button>
        <button type="button" className={styles.secondary} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
