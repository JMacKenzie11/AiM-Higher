import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getSfaDetail } from "@/lib/plan/service";
import { DetailHero } from "@/components/plan/DetailHero";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { SfaEditForm } from "./SfaEditForm";
import { StatusPicker } from "../../StatusPicker";
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
      <DetailHero
        breadcrumbHref="/plan"
        breadcrumbLabel="Back to plan"
        eyebrow="Strategic Focus Area"
        title={detail.sfa.title}
        meta={
          <>
            <span>Sponsor: {sponsor?.full_name ?? "Unassigned"}</span>
            <span>·</span>
            <StatusChip status={detail.sfa.status} />
            <span>·</span>
            <ProgressBar percent={detail.percent} label="No progress yet" />
          </>
        }
      >
        {detail.sfa.description ? (
          <p className={styles.bodyText}>{detail.sfa.description}</p>
        ) : null}

        {isSponsor && !isAdmin ? (
          <StatusPicker
            level="sfa"
            id={detail.sfa.id}
            current={detail.sfa.status}
          />
        ) : null}
      </DetailHero>

      {isAdmin ? (
        <section className={styles.card} aria-labelledby="edit-sfa">
          <h2 id="edit-sfa" className={styles.h2}>
            Edit focus area
          </h2>
          <SfaEditForm sfa={detail.sfa} people={detail.people} />
        </section>
      ) : null}

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
