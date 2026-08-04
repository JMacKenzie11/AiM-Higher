import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTrainingById } from "@/lib/classroom/service";
import type { ClassroomLesson } from "@/lib/classroom/types";
import { TrainingEditForm } from "./TrainingEditForm";
import { AttachmentsPanel } from "./AttachmentsPanel";
import styles from "../../../../companies/admin.module.css";

type PageProps = { params: Promise<{ id: string }> };

export default async function TrainingEditPage({ params }: PageProps) {
  await requireRole(["system_admin"]);
  const { id } = await params;
  const training = await getTrainingById(id);
  if (!training) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: lessons } = await supabase
    .from("classroom_lessons")
    .select("id, title, category_id, slug, description, sort_order, published, created_at, updated_at")
    .order("title");
  const allLessons = (lessons ?? []) as ClassroomLesson[];

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Training editor">
        <div className={styles.heroInner}>
          <Link
            href={`/admin/classroom/lessons/${training.lesson_id}/edit`}
            className={styles.crumbLink}
          >
            ← Back to lesson
          </Link>
          <p className={styles.eyebrow}>Training</p>
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
        <section className={styles.card} aria-labelledby="training-form">
          <h2 id="training-form" className={styles.h2}>
            Training details
          </h2>
          <TrainingEditForm training={training} lessons={allLessons} />
        </section>

        <section className={styles.card} aria-labelledby="attachments">
          <h2 id="attachments" className={styles.h2}>
            Attachments
          </h2>
          <p className={styles.subtitleInline}>
            Upload PDFs, slide decks, or other supporting files. Learners see
            them as download links below the video.
          </p>
          <AttachmentsPanel
            trainingId={training.id}
            attachments={training.attachments}
          />
        </section>
      </div>
    </div>
  );
}
