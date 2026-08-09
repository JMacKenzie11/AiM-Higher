"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishRoleDescriptionAction } from "@/lib/role-descriptions/publish-action";
import styles from "./role-description.module.css";

// Admin-only "Publish" pill in the RD view toolbar. Opens a small
// notes textarea (optional — a version can be published with no
// note); Publish snapshots the current cached document + overrides
// into role_description_versions as an immutable version.

export function PublishButton({ functionId }: { functionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await publishRoleDescriptionAction({
        functionId,
        notes: notes.trim() || null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      setNotes("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className={styles.publishButton}
        onClick={() => setOpen(true)}
        title="Snapshot the current role description as an immutable version"
      >
        Publish version
      </button>
    );
  }

  return (
    <div className={styles.publishInline}>
      <input
        type="text"
        className={styles.publishNotes}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional note — what changed in this version"
        disabled={pending}
        autoFocus
        aria-label="Version notes"
      />
      <button
        type="button"
        className={styles.publishButton}
        onClick={run}
        disabled={pending}
      >
        {pending ? "Publishing…" : "Publish"}
      </button>
      <button
        type="button"
        className={styles.editableGhost}
        onClick={() => {
          setOpen(false);
          setNotes("");
          setError(null);
        }}
        disabled={pending}
      >
        Cancel
      </button>
      {error ? (
        <p role="alert" className={styles.regenerateError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
