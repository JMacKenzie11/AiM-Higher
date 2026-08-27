import Link from "next/link";
import type { ClassroomTraining } from "@/lib/classroom/types";
import styles from "../../../../../classroom/classroom.module.css";

// Sticky left-rail listing every Section in the same Lesson.
// Mirrors the shape the viewer's LessonView uses so admins edit
// in the same visual layout their students will read. Each tab
// links to the sibling section's edit page. Active tab
// highlighted, others clickable.

export function SectionRail({
  lessonId,
  sections,
  activeSectionId,
}: {
  lessonId: string;
  sections: ClassroomTraining[];
  activeSectionId: string;
}) {
  return (
    <aside className={styles.sectionRail} aria-label="Sections in this lesson">
      <nav className={styles.sectionNav}>
        {sections.map((s, i) => {
          const isActive = s.id === activeSectionId;
          return (
            <Link
              key={s.id}
              href={`/admin/classroom/trainings/${s.id}/edit`}
              className={
                isActive
                  ? `${styles.sectionTab} ${styles.sectionTabActive}`
                  : styles.sectionTab
              }
              aria-current={isActive ? "page" : undefined}
            >
              <span className={styles.sectionTabIndex}>{i + 1}</span>
              <span className={styles.sectionTabTitle}>
                {s.title}
                {!s.published ? " (draft)" : ""}
              </span>
            </Link>
          );
        })}
        <Link
          href={`/admin/classroom/lessons/${lessonId}/edit`}
          className={styles.sectionTab}
        >
          <span className={styles.sectionTabIndex}>+</span>
          <span className={styles.sectionTabTitle}>Manage sections</span>
        </Link>
      </nav>
    </aside>
  );
}
