import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getGoalDetail } from "@/lib/plan/service";
import { DetailHero } from "@/components/plan/DetailHero";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { GoalEditForm } from "./GoalEditForm";
import { StatusPicker } from "../../StatusPicker";
import styles from "../../plan-detail.module.css";

type PageProps = { params: Promise<{ id: string }> };

export default async function GoalDetailPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getGoalDetail(id);
  if (!detail) notFound();

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  const isOwner = detail.goal.owner_id === session.profile.id;
  const owner =
    detail.people.find((p) => p.id === detail.goal.owner_id) ?? null;

  return (
    <>
      <DetailHero
        breadcrumbHref="/plan"
        breadcrumbLabel="Back to plan"
        eyebrow="Annual Goal"
        title={detail.goal.title}
        meta={
          <>
            {detail.sfa ? (
              <Link
                href={`/plan/sfa/${detail.sfa.id}`}
                className={styles.rowTitle}
              >
                Focus area: {detail.sfa.title}
              </Link>
            ) : (
              <span>Not linked to a focus area</span>
            )}
            <span>·</span>
            <span>Owner: {owner?.full_name ?? "Unassigned"}</span>
            {detail.goal.target_date ? (
              <>
                <span>·</span>
                <span>Target {detail.goal.target_date}</span>
              </>
            ) : null}
            <span>·</span>
            <StatusChip status={detail.goal.status} />
            <span>·</span>
            <ProgressBar percent={detail.percent} label="No priorities yet" />
          </>
        }
      >
        {detail.goal.description ? (
          <p className={styles.bodyText}>{detail.goal.description}</p>
        ) : null}

        {isOwner && !isAdmin ? (
          <StatusPicker
            level="goal"
            id={detail.goal.id}
            current={detail.goal.status}
          />
        ) : null}
      </DetailHero>

      {isAdmin ? (
        <section className={styles.card} aria-labelledby="edit-goal">
          <h2 id="edit-goal" className={styles.h2}>
            Edit annual goal
          </h2>
          <GoalEditForm
            goal={detail.goal}
            people={detail.people}
            sfaOptions={detail.sfaOptions}
          />
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="priorities">
        <h2 id="priorities" className={styles.h2}>
          Priorities under this goal
        </h2>
        {detail.priorities.length === 0 ? (
          <p className={styles.emptyLine}>
            No priorities linked yet. Add one from the Plan page.
          </p>
        ) : (
          <ul className={styles.rowList}>
            {detail.priorities.map((priority) => (
              <li key={priority.id} className={styles.row}>
                <div>
                  <Link
                    href={`/plan/priority/${priority.id}`}
                    className={styles.rowTitle}
                  >
                    {priority.title}
                  </Link>
                  <p className={styles.rowMeta}>
                    {priority.due_date ? `Due ${priority.due_date}` : "No due date"}
                  </p>
                </div>
                <StatusChip status={priority.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
