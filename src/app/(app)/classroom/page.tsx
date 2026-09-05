import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { listCategoriesWithLessons } from "@/lib/classroom/service";
import { PageShell } from "@/components/ui/PageShell";
import styles from "./classroom.module.css";

// Classroom landing.
//
// Two blocks, because the library has two kinds of content in it:
//
//   1. Phase 1 sits at the top as a numbered sequence, styled to
//      match the "Set up {Company}" checklist on /scorecard. These
//      five trainings exist to support the five setup steps, one for
//      one and in the same order, so they should read as the same
//      run of steps rather than as five unrelated tiles.
//   2. Everything else keeps the flat grid of lesson cards. Later
//      phases are a library, not a sequence, so the grid is right
//      for them.
//
// Categories are otherwise still an internal organizing tool (see
// /admin/classroom) and their names are not shown in the grid.
// Feature-gated at the route level; if the caller's company doesn't
// have 'classroom' we bounce back to Dashboard so a nav bookmark to a
// feature-off company doesn't render an empty page.

// The one category name that gets the sequence treatment. Matched on
// the name rather than the slug because the slug is author-set and
// currently reads "build-the-team"; renaming the category in the
// admin moves it into the grid, which is the intended escape hatch.
const SEQUENCE_CATEGORY = "phase 1";

export default async function ClassroomPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  if (!(await companyHasFeature(companyId, "classroom"))) {
    redirect("/dashboard");
  }

  const groups = await listCategoriesWithLessons();
  const sequence =
    groups.find(
      (g) =>
        g.name.trim().toLowerCase() === SEQUENCE_CATEGORY && g.lessons.length > 0,
    ) ?? null;
  // Everything that isn't the sequence flattens into one grid. We keep
  // the category order the service returned (SORT_ORDER on categories)
  // so authors can still control what appears first without exposing
  // the category label.
  const lessons = groups
    .filter((g) => g !== sequence)
    .flatMap((g) => g.lessons);

  const hasNothing = !sequence && lessons.length === 0;

  return (
    <PageShell
      eyebrow="Classroom"
      title="Lessons and trainings"
      subtitle="A shared library authored by AiMS. Click through to a lesson and watch the trainings inside."
    >
      {hasNothing ? (
        <section className={styles.card}>
          <p className={styles.emptyLine}>
            No lessons published yet. Check back soon.
          </p>
        </section>
      ) : null}

      {sequence ? (
        <section className={styles.card} aria-labelledby="classroom-sequence">
          <div className={styles.sequenceHeader}>
            <div>
              <h2 id="classroom-sequence" className={styles.sequenceTitle}>
                {sequence.name}
              </h2>
              <p className={styles.sequenceMeta}>
                Trainings that walk you through the setup steps, in the order
                you will do them.
              </p>
            </div>
            <div className={styles.sequenceBadge} aria-hidden="true">
              {sequence.lessons.length}{" "}
              {sequence.lessons.length === 1 ? "training" : "trainings"}
            </div>
          </div>
          <ol className={styles.sequenceList}>
            {sequence.lessons.map((l, i) => (
              <li key={l.id}>
                <Link
                  href={`/classroom/lessons/${l.slug}`}
                  className={styles.sequenceStep}
                >
                  <span className={styles.sequenceIndex} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className={styles.sequenceBody}>
                    <span className={styles.sequenceStepTitle}>{l.title}</span>
                    {l.description ? (
                      <span className={styles.sequenceStepDescription}>
                        {l.description}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.sequenceAction} aria-hidden="true">
                    Open →
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {lessons.length > 0 ? (
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
      ) : null}
    </PageShell>
  );
}
