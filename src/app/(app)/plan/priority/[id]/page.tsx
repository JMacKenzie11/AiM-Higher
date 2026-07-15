import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getPriorityDetail } from "@/lib/plan/service";
import {
  getCommitmentHistoryForPriority,
  type WeekGroup,
} from "@/lib/commitments/service";
import { CommitmentResolutionChip } from "@/components/plan/CommitmentResolutionChip";
import { PriorityHeroPanel } from "./PriorityHeroPanel";
import styles from "../../plan-detail.module.css";

type PageProps = { params: Promise<{ id: string }> };

export default async function PriorityDetailPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getPriorityDetail(id);
  if (!detail) notFound();

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  const isOwner = detail.priority.owner_id === session.profile.id;
  const owner = detail.people.find((p) => p.id === detail.priority.owner_id) ?? null;

  const history = await getCommitmentHistoryForPriority(detail.priority.id);

  return (
    <>
      <PriorityHeroPanel
        priority={detail.priority}
        people={detail.people}
        goalOptions={detail.goalOptions}
        quarters={detail.quarters}
        goal={detail.goal}
        quarter={detail.quarter}
        owner={owner}
        progressPercent={detail.progress?.percent ?? null}
        isAdmin={isAdmin}
        isOwner={isOwner}
      />

      <section className={styles.card} aria-labelledby="history">
        <h2 id="history" className={styles.h2}>
          Commitment history
        </h2>
        {history.length === 0 ? (
          <p className={styles.emptyLine}>
            No commitments logged against this priority yet. Add them from
            the Commitments page.
          </p>
        ) : (
          <>
            {/* Show the 4 most recent weeks by default; older weeks
                collapse behind a summary so long-running priorities
                don't produce a wall of text. */}
            {history.slice(0, 4).map((group) => (
              <HistoryWeek key={group.weekEnding} group={group} />
            ))}
            {history.length > 4 ? (
              <details className={styles.olderDetails}>
                <summary className={styles.olderSummary}>
                  Show {history.length - 4} earlier{" "}
                  {history.length - 4 === 1 ? "week" : "weeks"}
                </summary>
                {history.slice(4).map((group) => (
                  <HistoryWeek key={group.weekEnding} group={group} />
                ))}
              </details>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

function HistoryWeek({ group }: { group: WeekGroup }) {
  return (
    <div>
      <div className={styles.weekGroup}>Week ending {group.weekEnding}</div>
      <table className={styles.historyTable}>
        <thead>
          <tr>
            <th>Owner</th>
            <th>Description</th>
            <th>Due</th>
            <th>Resolution</th>
          </tr>
        </thead>
        <tbody>
          {group.commitments.map((commitment) => (
            <tr key={commitment.id}>
              <td>{commitment.owner?.full_name ?? "—"}</td>
              <td>
                {commitment.description}
                {commitment.missed_reason ? (
                  <p className={styles.reasonNote}>
                    Reason: {commitment.missed_reason}
                  </p>
                ) : null}
              </td>
              <td className={styles.dueCell}>{commitment.due_date}</td>
              <td>
                <CommitmentResolutionChip commitment={commitment} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
