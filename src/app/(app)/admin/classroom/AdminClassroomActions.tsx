"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createCategoryAction,
  createLessonAction,
  deleteLessonAction,
  moveLessonAction,
} from "@/lib/classroom/actions";
import type { CategoryWithLessons } from "@/lib/classroom/service";
import styles from "../companies/admin.module.css";

// The client half of /admin/classroom — needs interactivity for the
// inline "new lesson" and "new category" forms plus the move / delete
// row actions. The parent page fetches data server-side and passes
// the composed shape down.

export function AdminClassroomActions({
  groups,
}: {
  groups: CategoryWithLessons[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [newLessonTitle, setNewLessonTitle] = useState("");

  function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setMessage(null);
    startTransition(async () => {
      const result = await createCategoryAction(name);
      if (result.ok) {
        setNewCategoryName("");
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  function addLesson(categoryId: string | null) {
    const title = newLessonTitle.trim();
    if (!title) return;
    setMessage(null);
    startTransition(async () => {
      const result = await createLessonAction({
        title,
        category_id: categoryId,
        description: "",
        published: false,
      });
      if (result.ok) {
        setNewLessonTitle("");
        setCreatingIn(null);
        router.push(`/admin/classroom/lessons/${result.id}/edit`);
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  function moveLesson(id: string, direction: "up" | "down") {
    startTransition(async () => {
      await moveLessonAction(id, direction);
      router.refresh();
    });
  }

  function removeLesson(id: string) {
    if (!confirm("Delete this lesson and every training under it?")) return;
    setMessage(null);
    startTransition(async () => {
      const result = await deleteLessonAction(id);
      if (result.ok) router.refresh();
      else setMessage({ ok: false, text: result.message });
    });
  }

  const realGroups = groups.filter((g) => g.id !== "__uncategorized__");
  const orphans = groups.find((g) => g.id === "__uncategorized__");

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.h2}>New category</h2>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <input
            type="text"
            className={styles.input}
            style={{ flex: "1 1 260px" }}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="e.g., Foundational, Facilitation, Growth"
            disabled={pending}
          />
          <button
            type="button"
            className={styles.primaryButton}
            onClick={addCategory}
            disabled={pending || !newCategoryName.trim()}
          >
            Add category
          </button>
        </div>
        {message && !message.ok ? (
          <p role="alert" className={styles.errorMessage}>
            {message.text}
          </p>
        ) : null}
      </section>

      {realGroups.length === 0 && !orphans ? (
        <section className={styles.card}>
          <p className={styles.emptyLine}>
            No categories yet — add one above, then drop lessons into it.
          </p>
        </section>
      ) : null}

      {realGroups.map((g) => (
        <section key={g.id} className={styles.card} aria-labelledby={`cat-${g.id}`}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "var(--space-3)",
              flexWrap: "wrap",
            }}
          >
            <h2 id={`cat-${g.id}`} className={styles.h2}>
              {g.name}
            </h2>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() =>
                setCreatingIn(creatingIn === g.id ? null : g.id)
              }
              disabled={pending}
            >
              {creatingIn === g.id ? "Cancel" : "+ New lesson"}
            </button>
          </div>

          {creatingIn === g.id ? (
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
              <input
                type="text"
                className={styles.input}
                style={{ flex: "1 1 260px" }}
                value={newLessonTitle}
                onChange={(e) => setNewLessonTitle(e.target.value)}
                placeholder="Lesson title"
                disabled={pending}
                autoFocus
              />
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => addLesson(g.id)}
                disabled={pending || !newLessonTitle.trim()}
              >
                Create + edit
              </button>
            </div>
          ) : null}

          {g.lessons.length === 0 ? (
            <p className={styles.emptyLine} style={{ marginTop: "var(--space-3)" }}>
              No lessons in {g.name} yet.
            </p>
          ) : (
            <LessonList
              lessons={g.lessons}
              pending={pending}
              onMove={moveLesson}
              onDelete={removeLesson}
            />
          )}
        </section>
      ))}

      {orphans && orphans.lessons.length > 0 ? (
        <section className={styles.card}>
          <h2 className={styles.h2}>Uncategorized</h2>
          <p className={styles.subtitleInline}>
            Lessons without a category live here. Assign one on the lesson's
            edit page to move them.
          </p>
          <LessonList
            lessons={orphans.lessons}
            pending={pending}
            onMove={moveLesson}
            onDelete={removeLesson}
          />
        </section>
      ) : null}
    </>
  );
}

function LessonList({
  lessons,
  pending,
  onMove,
  onDelete,
}: {
  lessons: CategoryWithLessons["lessons"];
  pending: boolean;
  onMove: (id: string, direction: "up" | "down") => void;
  onDelete: (id: string) => void;
}) {
  return (
    <ul className={styles.list} style={{ marginTop: "var(--space-3)" }}>
      {lessons.map((l, i) => (
        <li key={l.id} className={styles.listItem}>
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
              <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <Link
                  href={`/admin/classroom/lessons/${l.id}/edit`}
                  className={styles.companyLink}
                >
                  {l.title}
                </Link>
                {!l.published ? (
                  <span className={styles.chipPending}>draft</span>
                ) : null}
              </div>
              <div className={styles.companyMeta}>
                {l.description ?? "No description yet."}
              </div>
            </div>
            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.ghostButton}
                disabled={pending || i === 0}
                onClick={() => onMove(l.id, "up")}
                aria-label={`Move ${l.title} up`}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                disabled={pending || i === lessons.length - 1}
                onClick={() => onMove(l.id, "down")}
                aria-label={`Move ${l.title} down`}
                title="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                className={styles.dangerGhost}
                disabled={pending}
                onClick={() => onDelete(l.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
