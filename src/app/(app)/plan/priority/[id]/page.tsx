import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { canWriteOwnedRow, isAdminForCompany } from "@/lib/auth/permissions";
import { getPriorityDetail } from "@/lib/plan/service";
import {
  getPriorityCommitmentPanelData,
  type WeekGroup,
} from "@/lib/commitments/service";
import { CommitmentRow } from "@/app/(app)/commitments/CommitmentRow";
import { InlineAddRow } from "@/app/(app)/commitments/InlineAddRow";
import commitmentStyles from "@/app/(app)/commitments/commitments.module.css";
import { PriorityHeroPanel } from "./PriorityHeroPanel";
import styles from "../../plan-detail.module.css";

type PageProps = { params: Promise<{ id: string }> };

export default async function PriorityDetailPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getPriorityDetail(id);
  if (!detail) notFound();

  const isAdmin = isAdminForCompany(
    session.profile,
    detail.priority.company_id
  );
  const isOwner = detail.priority.owner_id === session.profile.id;
  const owner = detail.people.find((p) => p.id === detail.priority.owner_id) ?? null;

  const panel = await getPriorityCommitmentPanelData(detail.priority.id, isAdmin);
  if (!panel) notFound();

  const rosterMinimal = panel.roster.map((p) => ({
    id: p.id,
    full_name: p.full_name,
  }));

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
        openCommitmentsCount={detail.progress?.open_count ?? 0}
        isAdmin={isAdmin}
        isOwner={isOwner}
      />

      <section className={styles.card} aria-labelledby="history">
        <h2 id="history" className={styles.h2}>
          Commitments
        </h2>

        <InlineAddRow
          thisFriday={panel.thisFriday}
          priorityOptions={[]}
          roster={rosterMinimal}
          currentUserId={session.profile.id}
          isAdmin={isAdmin}
          quarterCoversThisWeek={panel.quarterCoversThisWeek}
          noQuarterMessage={panel.noQuarterMessage}
          fixedPriorityId={detail.priority.id}
        />

        {panel.history.length === 0 ? (
          <p className={styles.emptyLine}>
            No commitments logged against this priority yet.
          </p>
        ) : (
          <>
            {panel.history.slice(0, 4).map((group) => (
              <HistoryWeek
                key={group.weekEnding}
                group={group}
                roster={rosterMinimal}
                todayIso={panel.todayIso}
                currentUserId={session.profile.id}
                isAdmin={isAdmin}
                sessionProfile={session.profile}
              />
            ))}
            {panel.history.length > 4 ? (
              <details className={styles.olderDetails}>
                <summary className={styles.olderSummary}>
                  Show {panel.history.length - 4} older{" "}
                  {panel.history.length - 4 === 1 ? "week" : "weeks"}
                </summary>
                {panel.history.slice(4).map((group) => (
                  <HistoryWeek
                    key={group.weekEnding}
                    group={group}
                    roster={rosterMinimal}
                    todayIso={panel.todayIso}
                    currentUserId={session.profile.id}
                    isAdmin={isAdmin}
                    sessionProfile={session.profile}
                  />
                ))}
              </details>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

function HistoryWeek({
  group,
  roster,
  todayIso,
  currentUserId,
  isAdmin,
  sessionProfile,
}: {
  group: WeekGroup;
  roster: Array<{ id: string; full_name: string }>;
  todayIso: string;
  currentUserId: string;
  isAdmin: boolean;
  sessionProfile: Parameters<typeof canWriteOwnedRow>[0];
}) {
  return (
    <div>
      <div className={styles.weekGroup}>Week ending {group.weekEnding}</div>
      <ul className={commitmentStyles.rowList}>
        {group.commitments.map((commitment) => (
          <CommitmentRow
            key={commitment.id}
            commitment={commitment}
            priorityOptions={[]}
            roster={roster}
            todayIso={todayIso}
            canResolve={canWriteOwnedRow(sessionProfile, commitment)}
            canLink={false}
            canReassign={canWriteOwnedRow(sessionProfile, commitment)}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            hidePriority
          />
        ))}
      </ul>
    </div>
  );
}
