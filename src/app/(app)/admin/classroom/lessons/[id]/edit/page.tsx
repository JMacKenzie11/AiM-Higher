import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { getLessonById, listCategories } from "@/lib/classroom/service";
import { LessonEditForm } from "./LessonEditForm";
import { TrainingsInLesson } from "./TrainingsInLesson";
import styles from "../../../../companies/admin.module.css";

// Edit page for a single lesson. Two blocks: the lesson metadata
// form (title/category/description/published) and the list of
// trainings inside it with add/move/delete/edit affordances.

type PageProps = { params: Promise<{ id: string }> };

export default async function LessonEditPage({ params }: PageProps) {
  await requireRole(["system_admin"]);
  const { id } = await params;
  const [lesson, categories] = await Promise.all([
    getLessonById(id),
    listCategories(),
  ]);
  if (!lesson) notFound();

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Lesson editor">
        <div className={styles.heroInner}>
          <Link href="/admin/classroom" className={styles.crumbLink}>
            ← All lessons
          </Link>
          <p className={styles.eyebrow}>Lesson</p>
          <h1 className={styles.h1}>{lesson.title}</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            {lesson.published
              ? "Published — visible to every Classroom-enabled company."
              : "Draft — invisible to consumers until you publish."}
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="lesson-form">
          <h2 id="lesson-form" className={styles.h2}>
            Lesson details
          </h2>
          <LessonEditForm lesson={lesson} categories={categories} />
        </section>

        <section className={styles.card} aria-labelledby="trainings">
          <h2 id="trainings" className={styles.h2}>
            Sections in this lesson
          </h2>
          <TrainingsInLesson
            lessonId={lesson.id}
            trainings={lesson.trainings}
          />
        </section>
      </div>
    </div>
  );
}
