"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteRoleDescriptionVersionAction } from "@/lib/role-descriptions/publish-action";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "./role-description.module.css";

// Client-side accordion of published Role Description versions.
// Server passes the list in already ordered newest-first; this
// component just renders + owns the delete confirm state.

export type VersionRow = {
  versionNumber: number;
  publishedAt: string;
  publishedByName: string | null;
  notes: string | null;
};

export function VersionsList({
  functionId,
  versions,
  canManage,
}: {
  functionId: string;
  versions: VersionRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (versions.length === 0) {
    return (
      <p className={styles.versionsEmpty}>
        No versions published yet. Hit Publish version above to snapshot
        the current role description.
      </p>
    );
  }

  function runDelete(versionNumber: number) {
    setPendingDelete(null);
    setError(null);
    startTransition(async () => {
      const result = await deleteRoleDescriptionVersionAction({
        functionId,
        versionNumber,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.versionsWrap}>
      {error ? (
        <p role="alert" className={styles.regenerateError}>
          {error}
        </p>
      ) : null}
      <ul className={styles.versionsList}>
        {versions.map((v) => (
          <li key={v.versionNumber} className={styles.versionRow}>
            <div className={styles.versionMain}>
              <Link
                href={`/chart/function/${functionId}/role-description/v/${v.versionNumber}`}
                className={styles.versionTitle}
              >
                Version {v.versionNumber}
              </Link>
              <p className={styles.versionMeta}>
                Published {formatRelative(v.publishedAt)}
                {v.publishedByName ? ` by ${v.publishedByName}` : ""}
              </p>
              {v.notes ? (
                <p className={styles.versionNotes}>{v.notes}</p>
              ) : null}
            </div>
            <div className={styles.versionActions}>
              <a
                href={`/chart/function/${functionId}/role-description/v/${v.versionNumber}/export.docx`}
                className={styles.versionLinkGhost}
                download
              >
                Download
              </a>
              {canManage ? (
                <button
                  type="button"
                  className={styles.versionLinkDanger}
                  onClick={() => setPendingDelete(v.versionNumber)}
                  disabled={pending}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete !== null
            ? `Delete version ${pendingDelete}?`
            : "Delete version?"
        }
        message="This version's snapshot is deleted permanently. Other versions and the current draft are unaffected."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          if (pendingDelete !== null) runDelete(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
        pending={pending}
      />
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMinutes = Math.max(0, Math.round((now - then) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
