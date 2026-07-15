import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getSfaDetail } from "@/lib/plan/service";
import { StatusChip } from "@/components/plan/StatusChip";
import { SfaHeroPanel } from "./SfaHeroPanel";
import styles from "../../plan-detail.module.css";

// SFA detail — Section 8.3.

type PageProps = { params: Promise<{ id: string }> };

export default async function SfaDetailPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getSfaDetail(id);
  if (!detail) notFound();

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  const isSponsor = detail.sfa.sponsor_id === session.profile.id;
  const sponsor = detail.people.find((p) => p.id === detail.sfa.sponsor_id) ?? null;

  return (
    <>
      <SfaHeroPanel
        sfa={detail.sfa}
        people={detail.people}
        sponsor={sponsor}
        percent={detail.percent}
        isAdmin={isAdmin}
        isSponsor={isSponsor}
      />

      <section className={styles.card} aria-labelledby="goals">
        <h2 id="goals" className={styles.h2}>
          Annual goals under this focus area
        </h2>
        {detail.goals.length === 0 ? (
          <p className={styles.emptyLine}>No annual goals linked yet.</p>
        ) : (
          <ul className={styles.rowList}>
            {detail.goals.map((goal) => (
              <li key={goal.id} className={styles.row}>
                <div>
                  <Link
                    href={`/plan/goal/${goal.id}`}
                    className={styles.rowTitle}
                  >
                    {goal.title}
                  </Link>
                  <p className={styles.rowMeta}>
                    {goal.owner_id ? "Assigned" : "Unassigned"}
                    {goal.target_date ? ` · Target ${goal.target_date}` : ""}
                  </p>
                </div>
                <StatusChip status={goal.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
