import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { getLessonBySlug } from "@/lib/classroom/service";
import styles from "../../classroom.module.css";

type PageProps = { params: Promise<{ slug: string }> };

export default async function LessonPage({ params }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  if (!(await companyHasFeature(companyId, "classroom"))) {
    redirect("/dashboard");
  }

  const { slug } = await params;
  const lesson = await getLessonBySlug(slug);
  if (!lesson) notFound();

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Lesson">
        <div className={styles.heroInner}>
          <Link href="/classroom" className={styles.crumbLink}>
            ← Classroom
          </Link>
          <p className={styles.eyebrow}>
            {lesson.category?.name ?? "Lesson"}
          </p>
          <h1 className={styles.h1}>{lesson.title}</h1>
          <span className={styles.rule} aria-hidden="true" />
          {lesson.description ? (
            <p className={styles.subtitle}>{lesson.description}</p>
          ) : null}
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card}>
          {lesson.trainings.length === 0 ? (
            <p className={styles.emptyLine}>
              No trainings in this lesson yet.
            </p>
          ) : (
            <ul className={styles.trainingList}>
              {lesson.trainings.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/classroom/trainings/${t.slug}`}
                    className={styles.trainingRow}
                  >
                    <div className={styles.trainingTextBlock}>
                      <h3 className={styles.trainingTitle}>{t.title}</h3>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
