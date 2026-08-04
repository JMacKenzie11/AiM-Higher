"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  deleteAttachmentAction,
  uploadAttachmentAction,
} from "@/lib/classroom/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ClassroomAttachment } from "@/lib/classroom/types";
import styles from "../../../../companies/admin.module.css";

export function AttachmentsPanel({
  trainingId,
  attachments,
}: {
  trainingId: string;
  attachments: ClassroomAttachment[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingRemove, setPendingRemove] = useState<ClassroomAttachment | null>(
    null
  );

  function upload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const fd = new FormData();
    fd.append("file", file);
    setMessage(null);
    startTransition(async () => {
      const result = await uploadAttachmentAction(trainingId, fd);
      if (result.ok) {
        setMessage({ ok: true, text: `Uploaded ${result.file_name}.` });
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  function runRemove() {
    if (!pendingRemove) return;
    const id = pendingRemove.id;
    setPendingRemove(null);
    setMessage(null);
    startTransition(async () => {
      const result = await deleteAttachmentAction(id);
      if (result.ok) router.refresh();
      else setMessage({ ok: false, text: result.message });
    });
  }

  return (
    <>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={inputRef}
          type="file"
          onChange={(e) => upload(e.target.files)}
          disabled={pending}
          style={{ flex: "1 1 260px" }}
        />
      </div>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? styles.successMessage : styles.errorMessage}
        >
          {message.text}
        </p>
      ) : null}

      {attachments.length === 0 ? (
        <p className={styles.emptyLine}>No attachments yet.</p>
      ) : (
        <ul className={styles.list}>
          {attachments.map((a) => (
            <li key={a.id} className={styles.listItem}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                  <div className={styles.itemName}>{a.file_name}</div>
                  <div className={styles.companyMeta}>
                    {a.mime_type ?? "file"}
                    {a.file_size
                      ? ` · ${formatBytes(a.file_size)}`
                      : ""}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.dangerGhost}
                    disabled={pending}
                    onClick={() => setPendingRemove(a)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pendingRemove !== null}
        title={
          pendingRemove
            ? `Remove "${pendingRemove.file_name}"?`
            : "Remove attachment?"
        }
        message="The file is deleted from storage. Learners will no longer see it under this training."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={runRemove}
        onCancel={() => setPendingRemove(null)}
        pending={pending}
      />
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
