import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getWeeklyReview } from "@/lib/commitments/weekly-review";
import { formatShortDate } from "@/lib/dates";
import { AddCommitmentForm } from "./AddCommitmentForm";
import { LastWeekRow } from "./LastWeekRow";
import { ThisWeekRow } from "./ThisWeekRow";
import styles from "./weekly-review.module.css";

// Weekly Review — Section 8.4. Two stacked sections plus a stat trio
// in the header. The week convention uses the company's timezone.

export default async function WeeklyReviewPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const data = await getWeeklyReview(companyId);
  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Weekly Review</h1>

        <div className={styles.statBar}>
          <span className={styles.statPill}>
            <span className={`${styles.statPillValue} aims-tabular`}>
              {data.stats.toReview}
            </span>
            <span className={styles.statPillLabel}>To review</span>
          </span>
          <span className={styles.statPill}>
            <span className={`${styles.statPillValue} aims-tabular`}>
              {data.stats.resolvedSoFar}
            </span>
            <span className={styles.statPillLabel}>Resolved so far</span>
          </span>
          <span className={styles.statPill}>
            <span className={`${styles.statPillValue} aims-tabular`}>
              {data.keepRate === null ? "—" : `${data.keepRate}%`}
            </span>
            <span className={styles.statPillLabel}>
              Follow-through this quarter
            </span>
          </span>
        </div>

        {!data.openQuarter ? (
          <div className={styles.noticeCard}>
            <p className={styles.noticeText}>
              No open quarter yet. Priorities and commitments live inside a
              quarter.
            </p>
            {isAdmin ? (
              <Link href="/quarters" className={styles.primaryLink}>
                Open this quarter
              </Link>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* ================= Last Week ================= */}
      <section className={styles.reviewSection} aria-labelledby="last-week">
        <div className={styles.sectionHeader}>
          <p className={styles.sectionEyebrow}>Reviewing</p>
          <h2 id="last-week" className={styles.h2}>
            Week ending {formatShortDate(data.lastFriday)}
          </h2>
          <span className="aims-rule" aria-hidden="true" />
          <p className={styles.sectionMeta}>
            Resolve every open commitment before moving on to this week.
          </p>
        </div>

        {data.lastWeekGroups.length === 0 ? (
          <p className={styles.emptyLine}>
            Nothing left to review. Nice work.
          </p>
        ) : (
          data.lastWeekGroups.map((group) => (
            <OwnerBlock
              key={group.owner?.id ?? "unowned"}
              ownerName={group.owner?.full_name ?? "Unassigned"}
              ownerPosition={group.owner?.position ?? null}
            >
              {group.commitments.map((commitment) => (
                <LastWeekRow
                  key={commitment.id}
                  commitment={commitment}
                  canAct={
                    isAdmin || commitment.owner_id === session.profile.id
                  }
                />
              ))}
            </OwnerBlock>
          ))
        )}
      </section>

      {/* ================= This Week ================= */}
      <section className={styles.reviewSection} aria-labelledby="this-week">
        <div className={styles.sectionHeader}>
          <p className={styles.sectionEyebrow}>Planning</p>
          <h2 id="this-week" className={styles.h2}>
            Week ending {formatShortDate(data.thisFriday)}
          </h2>
          <span className="aims-rule" aria-hidden="true" />
          <p className={styles.sectionMeta}>
            What will move a priority forward before Friday?
          </p>
        </div>

        {data.openQuarter && data.priorityOptions.length > 0 ? (
          <div className={styles.composerCard}>
            <h3 className={styles.h3}>Add a commitment</h3>
            <AddCommitmentForm
              weekEnding={data.thisFriday}
              priorityOptions={data.priorityOptions}
              roster={data.roster}
              currentUserId={session.profile.id}
              isAdmin={isAdmin}
            />
          </div>
        ) : (
          <NoPrioritiesTile isAdmin={isAdmin} />
        )}

        {data.thisWeekGroups.length === 0 ? (
          <EmptyThisWeek />
        ) : (
          data.thisWeekGroups.map((group) => (
            <OwnerBlock
              key={group.owner?.id ?? "unowned"}
              ownerName={group.owner?.full_name ?? "Unassigned"}
              ownerPosition={group.owner?.position ?? null}
            >
              {group.commitments.map((commitment) => (
                <ThisWeekRow
                  key={commitment.id}
                  commitment={commitment}
                  canAct={
                    isAdmin || commitment.owner_id === session.profile.id
                  }
                />
              ))}
            </OwnerBlock>
          ))
        )}
      </section>
    </div>
  );
}

function OwnerBlock({
  ownerName,
  ownerPosition,
  children,
}: {
  ownerName: string;
  ownerPosition: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.ownerBlock}>
      <div className={styles.ownerHeader}>
        <span className={styles.ownerName}>{ownerName}</span>
        {ownerPosition ? (
          <span className={styles.ownerPosition}>{ownerPosition}</span>
        ) : null}
      </div>
      <ul className={styles.rowList}>{children}</ul>
    </div>
  );
}

function EmptyThisWeek() {
  return (
    <div className={styles.emptyTile}>
      <p className={styles.emptyTileText}>
        No commitments yet this week. What will move a priority forward?
      </p>
    </div>
  );
}

function NoPrioritiesTile({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className={styles.emptyTile}>
      <p className={styles.emptyTileText}>
        {isAdmin
          ? "Add a priority in the current quarter before logging commitments."
          : "Ask your company admin to add a priority for this quarter."}
      </p>
      {isAdmin ? (
        <Link href="/plan" className={styles.primaryLinkOnDark}>
          Go to plan
        </Link>
      ) : null}
    </div>
  );
}
