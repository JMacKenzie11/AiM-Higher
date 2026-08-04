import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { listCategoriesWithLessons } from "@/lib/classroom/service";
import styles from "./classroom.module.css";

// Classroom landing — categories on top, lessons in a grid under
// each. Feature-gated at the route level; if the caller's company
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
  const anyLessons = groups.some((g) => g.lessons.length > 0);

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Classroom">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Classroom</p>
          <h1 className={styles.h1}>Lessons and trainings</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            A shared library authored by AiMS. Browse by category, click
            through to a lesson, and watch the trainings inside.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        {!anyLessons ? (
          <section className={styles.card}>
            <p className={styles.emptyLine}>
              No lessons published yet. Check back soon.
            </p>
          </section>
        ) : (
          groups
            .filter((g) => g.lessons.length > 0)
            .map((g) => (
              <section key={g.id} className={styles.card}>
                <div className={styles.categoryHeading}>
                  <h2 className={styles.categoryName}>{g.name}</h2>
                </div>
                <div className={styles.lessonGrid}>
                  {g.lessons.map((l) => (
                    <Link
                      key={l.id}
                      href={`/classroom/lessons/${l.slug}`}
                      className={styles.lessonCard}
                    >
                      <h3 className={styles.lessonTitle}>{l.title}</h3>
                      {l.description ? (
                        <p className={styles.lessonDescription}>
                          {l.description}
                        </p>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </section>
            ))
        )}
      </div>
    </div>
  );
}
