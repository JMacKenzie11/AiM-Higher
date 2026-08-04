"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  updateLessonAction,
  type LessonInput,
} from "@/lib/classroom/actions";
import type {
  ClassroomCategory,
  ClassroomLesson,
  ClassroomTraining,
} from "@/lib/classroom/types";
import styles from "../../../../companies/admin.module.css";

export function LessonEditForm({
  lesson,
  categories,
}: {
  lesson: ClassroomLesson & { trainings: ClassroomTraining[] };
  categories: ClassroomCategory[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [form, setForm] = useState<LessonInput>({
    title: lesson.title,
    slug: lesson.slug,
    category_id: lesson.category_id,
    description: lesson.description ?? "",
    published: lesson.published,
  });

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateLessonAction(lesson.id, form);
      if (result.ok) {
        setMessage({ ok: true, text: "Lesson saved." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="lesson-title" className={styles.label}>
          Title
        </label>
        <input
          id="lesson-title"
          type="text"
          className={styles.input}
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="lesson-category" className={styles.label}>
          Category
        </label>
        <select
          id="lesson-category"
          className={styles.select}
          value={form.category_id ?? ""}
          onChange={(e) =>
            setForm((p) => ({
              ...p,
              category_id: e.target.value === "" ? null : e.target.value,
            }))
          }
          disabled={pending}
        >
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className={`${styles.field} ${styles.formFull}`}>
        <label htmlFor="lesson-desc" className={styles.label}>
          Description
        </label>
        <textarea
          id="lesson-desc"
          className={styles.input}
          value={form.description}
          onChange={(e) =>
            setForm((p) => ({ ...p, description: e.target.value }))
          }
          rows={3}
          disabled={pending}
          placeholder="A sentence or two shown on the Classroom landing card."
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="lesson-slug" className={styles.label}>
          Slug
        </label>
        <input
          id="lesson-slug"
          type="text"
          className={styles.input}
          value={form.slug ?? ""}
          onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="lesson-published" className={styles.label}>
          Visibility
        </label>
        <label
          htmlFor="lesson-published"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            marginTop: "var(--space-2)",
          }}
        >
          <input
            id="lesson-published"
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
          {pending ? "Saving…" : "Save lesson"}
        </button>
      </div>
    </div>
  );
}
