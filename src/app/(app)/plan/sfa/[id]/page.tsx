import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getSfaDetail } from "@/lib/plan/service";
import { StatusChip } from "@/components/plan/StatusChip";
import { SfaHeroPanel } from "./SfaHeroPanel";
import { AddGoalForm } from "../../AddGoalForm";
import { AddPriorityForm } from "../../AddPriorityForm";
import { formatParentRef } from "@/lib/plan/parent-ref";
import styles from "../../plan-detail.module.css";
import planStyles from "../../plan.module.css";

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

      {/* Goals and direct priorities are peers under a focus area
          (migration 0209), so they share one list and one heading.
          Each row says which level it is, because "Goals and
          priorities" as a heading does not tell you which of the two
          any given row is. */}
      <section className={styles.card} aria-labelledby="children">
        <h2 id="children" className={styles.h2}>
          Goals and priorities under this focus area
        </h2>
        {detail.goals.length === 0 && detail.priorities.length === 0 ? (
          <p className={styles.emptyLine}>Nothing linked yet.</p>
        ) : (
          <ul className={styles.rowList}>
            {detail.goals.map((goal) => (
              <li key={goal.id} className={styles.row}>
                <div>
                  <span className={planStyles.levelLabel}>Goal</span>
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
            {detail.priorities.map((priority) => (
              <li key={priority.id} className={styles.row}>
                <div>
                  <span className={planStyles.levelLabel}>
                    Quarterly Priority
                  </span>
                  <Link
                    href={`/plan/priority/${priority.id}`}
                    className={styles.rowTitle}
                  >
                    {priority.title}
                  </Link>
                  <p className={styles.rowMeta}>
                    {priority.owner_id ? "Assigned" : "Unassigned"}
                    {priority.due_date ? ` · Due ${priority.due_date}` : ""}
                  </p>
                </div>
                <StatusChip status={priority.status} />
              </li>
            ))}
          </ul>
        )}

        {isAdmin ? (
          <details className={planStyles.addDetails}>
            <summary className={planStyles.addSummary}>
              + Add goal
            </summary>
            <AddGoalForm
              defaultSfaId={detail.sfa.id}
              sfaOptions={[{ id: detail.sfa.id, title: detail.sfa.title }]}
              people={detail.people}
            />
          </details>
        ) : null}

        {/* A priority needs a quarter, so this control is absent
            rather than broken when no quarter is open — the same
            rule /plan uses. */}
        {isAdmin && detail.openQuarter ? (
          <details className={planStyles.addDetails}>
            <summary className={planStyles.addSummary}>
              + Add quarterly priority
            </summary>
            <AddPriorityForm
              quarterId={detail.openQuarter.id}
              defaultParent={formatParentRef({
                kind: "sfa",
                id: detail.sfa.id,
              })}
              goalOptions={detail.goals.map((g) => ({
                id: g.id,
                title: g.title,
              }))}
              sfaOptions={[{ id: detail.sfa.id, title: detail.sfa.title }]}
              people={detail.people}
            />
          </details>
        ) : null}
      </section>
    </>
  );
}
