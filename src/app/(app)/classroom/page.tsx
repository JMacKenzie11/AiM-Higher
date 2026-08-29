import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { listCategoriesWithLessons } from "@/lib/classroom/service";
import { PageShell } from "@/components/ui/PageShell";
import styles from "./classroom.module.css";

// Classroom landing — a flat grid of every published lesson.
// Categories still exist and are still used to organize the
// library internally (see /classroom-admin), but end users get
// one clean list and don't need to know about that grouping.
// Feature-gated at the route level; if the caller's company
// doesn't have 'classroom' we bounce back to Dashboard so a nav
// bookmark to a feature-off company doesn't render an empty page.

export default async function ClassroomPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  if (!(await companyHasFeature(companyId, "classroom"))) {
    redirect("/dashboard");
  }

  const groups = await listCategoriesWithLessons();
  // Flatten categories → lessons. We keep the category order the
  // service returned (SORT_ORDER on categories) so authors can still
  // control what appears first without exposing the category label.
  const lessons = groups.flatMap((g) => g.lessons);

  return (
    <PageShell
      eyebrow="Classroom"
      title="Lessons and trainings"
      subtitle="A shared library authored by AiMS. Click through to a lesson and watch the trainings inside."
    >
      {lessons.length === 0 ? (
        <section className={styles.card}>
          <p className={styles.emptyLine}>
            No lessons published yet. Check back soon.
          </p>
        </section>
      ) : (
        <section className={styles.card}>
          <div className={styles.lessonGrid}>
            {lessons.map((l) => (
              <Link
                key={l.id}
                href={`/classroom/lessons/${l.slug}`}
                className={styles.lessonCard}
              >
                <h3 className={styles.lessonTitle}>{l.title}</h3>
                {l.description ? (
                  <p className={styles.lessonDescription}>{l.description}</p>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}
