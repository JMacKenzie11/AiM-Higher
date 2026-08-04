"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createTrainingAction,
  deleteTrainingAction,
  moveTrainingAction,
} from "@/lib/classroom/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ClassroomTraining } from "@/lib/classroom/types";
import styles from "../../../../companies/admin.module.css";

// Sub-panel on the lesson edit page — the ordered list of trainings
// with quick-add and inline row actions. New training creation is a
// two-field flow (title + URL) and lands the sysadmin on the training
// edit page for the body + attachments work.

export function TrainingsInLesson({
  lessonId,
  trainings,
}: {
  lessonId: string;
  trainings: ClassroomTraining[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [showAdd, setShowAdd] = useState(trainings.length === 0);
  const [title, setTitle] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ClassroomTraining | null>(
    null
  );

  function add() {
    if (!title.trim() || !videoUrl.trim()) return;
    setMessage(null);
    startTransition(async () => {
      const result = await createTrainingAction({
        lesson_id: lessonId,
        title,
        video_url: videoUrl,
        body_json: null,
        published: false,
      });
      if (result.ok) {
        router.push(`/admin/classroom/trainings/${result.id}/edit`);
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  function move(id: string, direction: "up" | "down") {
    startTransition(async () => {
      await moveTrainingAction(id, direction);
      router.refresh();
    });
  }

  function runRemove() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setMessage(null);
    startTransition(async () => {
      const result = await deleteTrainingAction(id);
      if (result.ok) router.refresh();
      else setMessage({ ok: false, text: result.message });
    });
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--space-3)" }}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => setShowAdd((v) => !v)}
          disabled={pending}
        >
          {showAdd ? "Cancel" : "+ New training"}
        </button>
      </div>

      {showAdd ? (
        <div className={styles.form} style={{ marginBottom: "var(--space-4)" }}>
          <div className={styles.field}>
            <label htmlFor="new-training-title" className={styles.label}>
              Training title
            </label>
            <input
              id="new-training-title"
              type="text"
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
              placeholder="e.g., Running a 4Ws session"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="new-training-url" className={styles.label}>
              Video URL (YouTube or Vimeo)
            </label>
            <input
              id="new-training-url"
              type="url"
              className={styles.input}
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={pending}
              placeholder="https://youtu.be/... or https://vimeo.com/..."
            />
          </div>
          <div className={styles.submitRow}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={add}
              disabled={pending || !title.trim() || !videoUrl.trim()}
            >
              Create + edit
            </button>
          </div>
        </div>
      ) : null}

      {message && !message.ok ? (
        <p role="alert" className={styles.errorMessage}>
          {message.text}
        </p>
      ) : null}

      {trainings.length === 0 ? (
        <p className={styles.emptyLine}>No trainings yet — add the first one above.</p>
      ) : (
        <ul className={styles.list}>
          {trainings.map((t, i) => (
            <li key={t.id} className={styles.listItem}>
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-3)",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                {t.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.thumbnail_url}
                    alt=""
                    width={96}
                    height={54}
                    style={{
                      borderRadius: "var(--radius-sm)",
                      objectFit: "cover",
                      background: "var(--aims-navy-tint)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 96,
                      height: 54,
                      borderRadius: "var(--radius-sm)",
                      background: "var(--aims-navy-tint)",
                    }}
                  />
                )}
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                    <Link
                      href={`/admin/classroom/trainings/${t.id}/edit`}
                      className={styles.companyLink}
                    >
                      {t.title}
                    </Link>
                    {!t.published ? (
                      <span className={styles.chipPending}>draft</span>
                    ) : null}
                  </div>
                  <div className={styles.companyMeta}>
                    {t.video_provider === "youtube" ? "YouTube" : "Vimeo"} · {t.video_id}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    disabled={pending || i === 0}
                    onClick={() => move(t.id, "up")}
                    title="Move up"
                    aria-label={`Move ${t.title} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    disabled={pending || i === trainings.length - 1}
                    onClick={() => move(t.id, "down")}
                    title="Move down"
                    aria-label={`Move ${t.title} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.dangerGhost}
                    disabled={pending}
                    onClick={() => setPendingDelete(t)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete
            ? `Delete "${pendingDelete.title}"?`
            : "Delete training?"
        }
        message="The video reference, notes, and any attachments are deleted with it. This can't be undone."
        confirmLabel="Delete training"
        tone="danger"
        onConfirm={runRemove}
        onCancel={() => setPendingDelete(null)}
        pending={pending}
      />
    </>
  );
}
