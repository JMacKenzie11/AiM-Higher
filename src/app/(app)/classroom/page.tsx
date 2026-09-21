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
// ONE SHAPE FOR EVERY PHASE. Each category renders as its own
// numbered sequence: heading, count badge, ordered list of trainings.
//
// It used to render Phase 1 that way and flatten everything else into
// a grid of bordered cards with no category heading at all, on the
// reasoning that later phases were "a library, not a sequence". They
// are not: Phase 2 is Build the Shared Identity → Create the Vision →
// Open Your Next Quarter → Continue Your Weekly Rhythm, which is as
// ordered as Phase 1 is. The two treatments read as two different
// kinds of content and there is only one kind.
//
// Flattening also dropped the category names, so Phase 2 and Phase 3
// ran together as one undifferentiated grid with no way to tell where
// one ended and the next began.
//
// Ordering is the service's: `sort_order` then `name`. Every category
// currently carries sort_order 0, so the name is what actually orders
// them — "Phase 1", "Phase 2", "Phase 3" sort correctly, and an
// author who wants a different order sets sort_order in
// /admin/classroom.
//
// Feature-gated at the route level; if the caller's company doesn't
// have 'classroom' we bounce back to Dashboard so a nav bookmark to a
// feature-off company doesn't render an empty page.

export default async function ClassroomPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  if (!(await companyHasFeature(companyId, "classroom"))) {
    redirect("/dashboard");
  }

  // An empty category is not a section. It would render a heading, a
  // "0 trainings" badge and nothing underneath, which reads as
  // something failing to load.
  const phases = (await listCategoriesWithLessons()).filter(
    (g) => g.lessons.length > 0,
  );
  const hasNothing = phases.length === 0;

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

      {phases.map((phase) => {
        const headingId = `classroom-phase-${phase.slug}`;
        return (
          <section className={styles.card} key={phase.id} aria-labelledby={headingId}>
            <div className={styles.sequenceHeader}>
              <div>
                <h2 id={headingId} className={styles.sequenceTitle}>
                  {phase.name}
                </h2>
                <p className={styles.sequenceMeta}>
                  Work through these in the order they are listed.
                </p>
              </div>
              <div className={styles.sequenceBadge} aria-hidden="true">
                {phase.lessons.length}{" "}
                {phase.lessons.length === 1 ? "training" : "trainings"}
              </div>
            </div>
            <ol className={styles.sequenceList}>
              {phase.lessons.map((l, i) => (
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
        );
      })}

    </PageShell>
  );
}
