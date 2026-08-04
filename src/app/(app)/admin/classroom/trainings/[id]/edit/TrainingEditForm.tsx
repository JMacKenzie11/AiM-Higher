"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateTrainingAction, type TrainingInput } from "@/lib/classroom/actions";
import type {
  ClassroomAttachment,
  ClassroomLesson,
  ClassroomTraining,
} from "@/lib/classroom/types";
import { TipTapEditor, type EditorJSON } from "@/components/tiptap/Editor";
import styles from "../../../../companies/admin.module.css";

export function TrainingEditForm({
  training,
  lessons,
}: {
  training: ClassroomTraining & { attachments: ClassroomAttachment[] };
  lessons: ClassroomLesson[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [form, setForm] = useState<TrainingInput>({
    lesson_id: training.lesson_id,
    title: training.title,
    slug: training.slug,
    video_url: training.video_url,
    body_json: training.body_json,
    published: training.published,
  });

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateTrainingAction(training.id, form);
      if (result.ok) {
        setMessage({ ok: true, text: "Training saved." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  function onBodyChange(json: EditorJSON) {
    setForm((p) => ({ ...p, body_json: json }));
  }

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="training-title" className={styles.label}>
          Title
        </label>
        <input
          id="training-title"
          type="text"
          className={styles.input}
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="training-lesson" className={styles.label}>
          Lesson
        </label>
        <select
          id="training-lesson"
          className={styles.select}
          value={form.lesson_id}
          onChange={(e) =>
            setForm((p) => ({ ...p, lesson_id: e.target.value }))
          }
          disabled={pending}
        >
          {lessons.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
              {!l.published ? " (draft)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className={`${styles.field} ${styles.formFull}`}>
        <label htmlFor="training-video" className={styles.label}>
          Video URL (YouTube or Vimeo)
        </label>
        <input
          id="training-video"
          type="url"
          className={styles.input}
          value={form.video_url}
          onChange={(e) =>
            setForm((p) => ({ ...p, video_url: e.target.value }))
          }
          disabled={pending}
        />
        {training.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={training.thumbnail_url}
            alt=""
            width={200}
            height={112}
            style={{
              marginTop: "var(--space-2)",
              borderRadius: "var(--radius-sm)",
              objectFit: "cover",
            }}
          />
        ) : null}
      </div>

      <div className={`${styles.field} ${styles.formFull}`}>
        <span className={styles.label}>Body</span>
        <TipTapEditor
          initial={form.body_json}
          onChange={onBodyChange}
          placeholder="Details, context, notes for the learner…"
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="training-slug" className={styles.label}>
          Slug
        </label>
        <input
          id="training-slug"
          type="text"
          className={styles.input}
          value={form.slug ?? ""}
          onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Visibility</span>
        <label
          htmlFor="training-published"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            marginTop: "var(--space-2)",
          }}
        >
          <input
            id="training-published"
            type="checkbox"
            checked={form.published}
            onChange={(e) =>
              setForm((p) => ({ ...p, published: e.target.checked }))
            }
            disabled={pending}
          />
          Published
        </label>
      </div>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? styles.successMessage : styles.errorMessage}
        >
          {message.text}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save training"}
        </button>
      </div>
    </div>
  );
}
