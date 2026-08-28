import Link from "next/link";
import type { LessonWithTrainings } from "@/lib/classroom/types";
import { TipTapRenderer } from "@/components/tiptap/Renderer";
import styles from "../../classroom.module.css";

// Shared left-rail tabbed view of a Lesson. Used by both:
//   /classroom/lessons/[slug]
//   /classroom/lessons/[slug]/[sectionSlug]
// so a shared link to a specific section renders the same shape
// as the default landing page — just with a different tab active.
//
// Rendered as a server component so the section body ships as
// pre-rendered React (the JSON walker in TipTapRenderer runs on
// the server and outputs static markup + client-only
// VideoEmbedPlayers for each embedded video).

export function LessonView({
  lesson,
  activeSection,
  debug = false,
}: {
  lesson: LessonWithTrainings;
  activeSection: LessonWithTrainings["trainings"][number] | null;
  // When true, dumps the section's raw body_json in a <pre> under
  // the rendered content. Threaded from the page via ?debug=json.
  debug?: boolean;
}) {
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
        {lesson.trainings.length === 0 ? (
          <section className={styles.card}>
            <p className={styles.emptyLine}>
              No sections in this lesson yet.
            </p>
          </section>
        ) : (
          <div className={styles.lessonLayout}>
            <aside
              className={styles.sectionRail}
              aria-label="Lesson sections"
            >
              <nav className={styles.sectionNav}>
                {lesson.trainings.map((t, i) => {
                  const isActive = activeSection?.id === t.id;
                  return (
                    <Link
                      key={t.id}
                      href={`/classroom/lessons/${lesson.slug}/${t.slug}`}
                      className={
                        isActive
                          ? `${styles.sectionTab} ${styles.sectionTabActive}`
                          : styles.sectionTab
                      }
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span className={styles.sectionTabIndex}>{i + 1}</span>
                      <span className={styles.sectionTabTitle}>{t.title}</span>
                    </Link>
                  );
                })}
              </nav>
            </aside>

            <section
              className={`${styles.card} ${styles.sectionPane}`}
              aria-label={activeSection?.title ?? "Section"}
            >
              {activeSection ? (
                <>
                  <h2 className={styles.sectionHeading}>
                    {activeSection.title}
                  </h2>
                  <TipTapRenderer json={activeSection.body_json} />
                  {/* Diagnostic dump. Reachable by appending
                      ?debug=json to the URL; hidden by default so
                      normal readers never see it. Delete once the
                      link-mark ↔ reader-render pipeline is confirmed
                      end-to-end. */}
                  {debug ? (
                    <pre
                      style={{
                        marginTop: "var(--space-4)",
                        padding: "var(--space-3)",
                        background: "var(--aims-navy-tint)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {JSON.stringify(activeSection.body_json, null, 2)}
                    </pre>
                  ) : null}
                </>
              ) : (
                <p className={styles.emptyLine}>Section not found.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
