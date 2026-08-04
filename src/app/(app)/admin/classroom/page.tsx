import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { listCategoriesWithLessons } from "@/lib/classroom/service";
import { AdminClassroomActions } from "./AdminClassroomActions";
import styles from "../companies/admin.module.css";

// System-admin authoring surface for the classroom. Lists every
// category with its lessons, gives quick "New lesson" and "New
// category" affordances, and links each lesson through to its edit
// page. Drafts show up here (RLS gives sysadmins all rows) so they
// can be worked on before publish.

export default async function AdminClassroomPage() {
  await requireRole(["system_admin"]);
  const groups = await listCategoriesWithLessons();

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Classroom authoring">
        <div className={styles.heroInner}>
          <Link href="/admin/companies" className={styles.crumbLink}>
            ← Admin home
          </Link>
          <p className={styles.eyebrow}>Admin</p>
          <h1 className={styles.h1}>Classroom</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Author lessons and video trainings for every Classroom-enabled
            company. Drafts stay hidden until you publish.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <AdminClassroomActions groups={groups} />
      </div>
    </div>
  );
}
