import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getGoalDetail } from "@/lib/plan/service";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { StatusChip } from "@/components/plan/StatusChip";
import { GoalHeroPanel } from "./GoalHeroPanel";
import { AddPriorityForm } from "../../AddPriorityForm";
import styles from "../../plan-detail.module.css";
import planStyles from "../../plan.module.css";

type PageProps = { params: Promise<{ id: string }> };

export default async function GoalDetailPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getGoalDetail(id);
  if (!detail) notFound();

  const openQuarter = await getCurrentQuarter(detail.goal.company_id);

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  const isOwner = detail.goal.owner_id === session.profile.id;
  const owner =
    detail.people.find((p) => p.id === detail.goal.owner_id) ?? null;

  return (
    <>
      <GoalHeroPanel
        goal={detail.goal}
        people={detail.people}
        sfaOptions={detail.sfaOptions}
        sfa={detail.sfa}
        owner={owner}
        percent={detail.percent}
        priorityCount={detail.priorities.length}
        openCommitmentsCount={detail.openCommitmentsCount}
        isAdmin={isAdmin}
        isOwner={isOwner}
      />

      <section className={styles.card} aria-labelledby="priorities">
        <h2 id="priorities" className={styles.h2}>
          Priorities under this goal
        </h2>
        {detail.priorities.length === 0 ? (
          <p className={styles.emptyLine}>No priorities linked yet.</p>
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

        {isAdmin ? (
          openQuarter ? (
            <details className={planStyles.addDetails}>
              <summary className={planStyles.addSummary}>
                + Add priority
              </summary>
              <AddPriorityForm
                quarterId={openQuarter.id}
                defaultGoalId={detail.goal.id}
                goalOptions={[{ id: detail.goal.id, title: detail.goal.title }]}
                people={detail.people}
              />
            </details>
          ) : (
            <p className={styles.emptyLine}>
              Open a quarter on the <Link href="/quarters">Quarters</Link> page
              before adding priorities.
            </p>
          )
        ) : null}
      </section>
    </>
  );
}
