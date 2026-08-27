import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTrainingById } from "@/lib/classroom/service";
import type {
  ClassroomLesson,
  ClassroomTraining,
} from "@/lib/classroom/types";
import { TrainingEditForm } from "./TrainingEditForm";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { SectionRail } from "./SectionRail";
import styles from "../../../../companies/admin.module.css";
import classroomStyles from "../../../../../classroom/classroom.module.css";

type PageProps = { params: Promise<{ id: string }> };

export default async function TrainingEditPage({ params }: PageProps) {
  await requireRole(["system_admin"]);
  const { id } = await params;
  const training = await getTrainingById(id);
  if (!training) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data: lessons }, { data: siblings }] = await Promise.all([
    supabase
      .from("classroom_lessons")
      .select("id, title, category_id, slug, description, sort_order, published, created_at, updated_at")
      .order("title"),
    // All sections in the same lesson, ordered to match the
    // consumer viewer — the admin sees the same shape as students.
    supabase
      .from("classroom_trainings")
      .select("*")
      .eq("lesson_id", training.lesson_id)
      .order("sort_order")
      .order("title"),
  ]);
  const allLessons = (lessons ?? []) as ClassroomLesson[];
  const siblingSections = (siblings ?? []) as ClassroomTraining[];

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Section editor">
        <div className={styles.heroInner}>
          <Link
            href={`/admin/classroom/lessons/${training.lesson_id}/edit`}
            className={styles.crumbLink}
          >
            ← Back to lesson
          </Link>
          <p className={styles.eyebrow}>Section</p>
          <h1 className={styles.h1}>{training.title}</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            {training.published
              ? "Published — visible to every Classroom-enabled company."
              : "Draft — invisible to consumers until you publish."}
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <div className={classroomStyles.lessonLayout}>
          <SectionRail
            lessonId={training.lesson_id}
            sections={siblingSections}
            activeSectionId={training.id}
          />

          <div
            className={classroomStyles.sectionPane}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            <section className={styles.card} aria-labelledby="training-form">
              <h2 id="training-form" className={styles.h2}>
                Section details
              </h2>
              <TrainingEditForm training={training} lessons={allLessons} />
            </section>

            <section className={styles.card} aria-labelledby="attachments">
              <h2 id="attachments" className={styles.h2}>
                Attachments
              </h2>
              <p className={styles.subtitleInline}>
                Upload PDFs, slide decks, or other supporting files. Learners
                see them as download links below the section body.
              </p>
              <AttachmentsPanel
                trainingId={training.id}
                attachments={training.attachments}
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
