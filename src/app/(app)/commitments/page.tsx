import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { canWriteOwnedRow } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import {
  getCommitmentsPageData,
  type CommitmentFilters,
} from "@/lib/commitments/service";
import { PageShell } from "@/components/ui/PageShell";
import { TermTooltip } from "@/components/ui/TermTooltip";
import { CommitmentRow } from "./CommitmentRow";
import { FilterPills } from "./FilterPills";
import { InlineAddRow } from "./InlineAddRow";
import { PriorWeekRow } from "./PriorWeekRow";
import styles from "./commitments.module.css";

// /commitments — one page, grouped by week, replacing /weekly-review.
// Pinned "Needs attention" (past-week + still open), then this week
// with the inline add row, then collapsed prior-week summaries.

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommitmentsPage({ searchParams }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const sp = await searchParams;
  const filters: CommitmentFilters = {
    owner: pickString(sp.owner, "all"),
    status: pickString(sp.status, "all") as CommitmentFilters["status"],
    type: pickString(sp.type, "all") as CommitmentFilters["type"],
  };

  const data = await getCommitmentsPageData(
    companyId,
    session.profile.id,
    filters
  );

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  const noQuarterMessage = isAdmin
    ? "No quarter is open for this week — open one to start adding commitments."
    : "No quarter is open for this week. Ask your company admin to open one.";

  return (
    <PageShell
      eyebrow="Company"
      title="Commitments"
      subtitle="Every agreement, in one place."
    >
      <div className={styles.statBar}>
        <span className={styles.statPill}>
          <span className={`${styles.statPillValue} aims-tabular`}>
            {data.headerStats.openThisWeek}
          </span>
          <span className={styles.statPillLabel}>Open this week</span>
        </span>
        <span className={styles.statPill}>
          <span className={`${styles.statPillValue} aims-tabular`}>
            {data.headerStats.needsAttentionCount}
          </span>
          <span className={styles.statPillLabel}>Needs attention</span>
        </span>
        <span className={styles.statPill}>
          <span className={`${styles.statPillValue} aims-tabular`}>
            {data.headerStats.keepRateThisQuarter === null
              ? "—"
              : `${data.headerStats.keepRateThisQuarter}%`}
          </span>
          <span className={styles.statPillLabel}>
            <TermTooltip term="followThroughRate" /> this quarter
          </span>
        </span>
      </div>

      {!data.openQuarter ? (
        <div className={styles.noticeCard}>
          <p className={styles.noticeText}>
            No open quarter yet. Actions live inside a quarter.
          </p>
          {isAdmin ? (
            <Link href="/quarters" className={styles.primaryLink}>
              Open this quarter →
            </Link>
          ) : null}
        </div>
      ) : null}

      <FilterPills
        currentUserId={session.profile.id}
        roster={data.roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
        owner={filters.owner}
        status={filters.status}
        type={filters.type}
      />

      {(() => {
        // Split mainList so the past-week still-open items surface in
        // their own "Needs attention" group pinned above This week.
        // The comment at the top of this file (and the header pill on
        // the same page) has always promised this grouping; the render
        // path had drifted to a single flat list.
        const needsAttention = data.mainList.filter(
          (c) => c.status === "open" && c.due_date < data.thisFriday
        );
        const thisWeekList = data.mainList.filter(
          (c) =>
            !(c.status === "open" && c.due_date < data.thisFriday)
        );
        const rosterMinimal = data.roster.map((p) => ({
          id: p.id,
          full_name: p.full_name,
        }));
        const renderRow = (c: typeof data.mainList[number]) => (
          <CommitmentRow
            key={c.id}
            commitment={c}
            priorityOptions={data.priorityOptions}
            roster={rosterMinimal}
            todayIso={data.todayIso}
            canResolve={canWriteOwnedRow(session.profile, c)}
            canLink={canWriteOwnedRow(session.profile, c)}
            canReassign={canWriteOwnedRow(session.profile, c)}
            currentUserId={session.profile.id}
            isAdmin={isAdmin}
          />
        );

        // Team-member-first sort: for non-admins, pull their own
        // rows out of the This Week list and pin them at the top as
        // "Yours this week", so a team member with lower software
        // fluency doesn't have to scan the whole list for their
        // name. Admins keep the original assigned-then-unassigned
        // layout — they're facilitating meetings and want everyone
        // in the same view.
        const currentUserId = session.profile.id;
        const yoursThisWeek = !isAdmin
          ? thisWeekList.filter((c) => c.owner_id === currentUserId)
          : [];
        const restThisWeek = !isAdmin
          ? thisWeekList.filter((c) => c.owner_id !== currentUserId)
          : thisWeekList;

        return (
          <>
            {needsAttention.length > 0 ? (
              <section
                className={styles.group}
                aria-labelledby="commitments-needs-attention"
              >
                <div className={styles.groupHeader}>
                  <h2
                    id="commitments-needs-attention"
                    className={`${styles.groupTitle} ${styles.groupTitleNeedsAttention}`}
                  >
                    Needs attention
                  </h2>
                  <span className={styles.groupMeta}>
                    {needsAttention.length} overdue
                  </span>
                </div>
                <ul className={styles.rowList}>
                  {needsAttention.map(renderRow)}
                </ul>
              </section>
            ) : null}

            {!isAdmin && yoursThisWeek.length > 0 ? (
              <section
                className={styles.group}
                aria-labelledby="commitments-yours"
              >
                <div className={styles.groupHeader}>
                  <h2 id="commitments-yours" className={styles.groupTitle}>
                    Yours this week
                  </h2>
                  <span className={styles.groupMeta}>
                    {yoursThisWeek.length}{" "}
                    {yoursThisWeek.length === 1 ? "commitment" : "commitments"}
                  </span>
                </div>
                <ul className={styles.rowList}>
                  {yoursThisWeek.map(renderRow)}
                </ul>
              </section>
            ) : null}

            <section
              className={styles.group}
              aria-labelledby="commitments-this-week"
            >
              <div className={styles.groupHeader}>
                <h2
                  id="commitments-this-week"
                  className={styles.groupTitle}
                >
                  {isAdmin ? "This week" : "Team this week"}
                </h2>
                <span className={styles.groupMeta}>
                  {restThisWeek.length}{" "}
                  {restThisWeek.length === 1 ? "commitment" : "commitments"}
                </span>
              </div>
              <ul className={styles.rowList}>
                {(() => {
                  const assigned = restThisWeek.filter(
                    (c) => c.owner_id !== null
                  );
                  const unassigned = restThisWeek.filter(
                    (c) => c.owner_id === null
                  );
                  return (
                    <>
                      {assigned.map(renderRow)}
                      {unassigned.length > 0 ? (
                        <li className={styles.unassignedHeading}>
                          Unassigned
                        </li>
                      ) : null}
                      {unassigned.map(renderRow)}
                    </>
                  );
                })()}
              </ul>
              <InlineAddRow
                thisFriday={data.thisFriday}
                priorityOptions={data.priorityOptions}
                roster={data.roster.map((p) => ({
                  id: p.id,
                  full_name: p.full_name,
                }))}
                currentUserId={session.profile.id}
                isAdmin={isAdmin}
                quarterCoversThisWeek={data.quarterCoversThisWeek}
                noQuarterMessage={noQuarterMessage}
              />
            </section>
          </>
        );
      })()}

      {data.futureList.length > 0 ? (
        <section
          className={styles.group}
          aria-labelledby="commitments-future-weeks"
        >
          <div className={styles.groupHeader}>
            <h2
              id="commitments-future-weeks"
              className={styles.groupTitle}
            >
              Future weeks
            </h2>
            <span className={styles.groupMeta}>
              {data.futureList.length}{" "}
              {data.futureList.length === 1 ? "commitment" : "commitments"}
            </span>
          </div>
          <ul className={styles.rowList}>
            {data.futureList.map((c) => (
              <CommitmentRow
                key={c.id}
                commitment={c}
                priorityOptions={data.priorityOptions}
                roster={data.roster.map((p) => ({
                  id: p.id,
                  full_name: p.full_name,
                }))}
                todayIso={data.todayIso}
                canResolve={canWriteOwnedRow(session.profile, c)}
                canLink={canWriteOwnedRow(session.profile, c)}
                canReassign={canWriteOwnedRow(session.profile, c)}
                currentUserId={session.profile.id}
                isAdmin={isAdmin}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {data.priorWeeks.length > 0 ? (
        <section aria-labelledby="prior-weeks">
          <div className={styles.groupHeader} style={{ borderRadius: "var(--radius-md)", marginBottom: "var(--space-3)" }}>
            <h2 id="prior-weeks" className={styles.groupTitle}>
              Prior weeks
            </h2>
            <span className={styles.groupMeta}>
              {data.priorWeeks.length} shown
            </span>
          </div>
          <div className={styles.summaryList}>
            {data.priorWeeks.map((week) => (
              <PriorWeekRow
                key={week.weekEnding}
                week={week}
                priorityOptions={data.priorityOptions}
                roster={data.roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
                todayIso={data.todayIso}
                currentUserId={session.profile.id}
                isAdmin={isAdmin}
                currentUserCompanyId={session.profile.company_id}
              />
            ))}
          </div>
        </section>
      ) : null}

      {data.parkedList.length > 0 ? (
        <section
          className={styles.group}
          aria-labelledby="commitments-parked"
          style={{ opacity: 0.85 }}
        >
          <div className={styles.groupHeader}>
            <h2 id="commitments-parked" className={styles.groupTitle}>
              Parking lot
            </h2>
            <span className={styles.groupMeta}>
              {data.parkedList.length}{" "}
              {data.parkedList.length === 1 ? "commitment" : "commitments"}
              {" — excluded from all counts"}
            </span>
          </div>
          <ul className={styles.rowList}>
            {data.parkedList.map((c) => (
              <CommitmentRow
                key={c.id}
                commitment={c}
                priorityOptions={data.priorityOptions}
                roster={data.roster.map((p) => ({
                  id: p.id,
                  full_name: p.full_name,
                }))}
                todayIso={data.todayIso}
                canResolve={canWriteOwnedRow(session.profile, c)}
                canLink={canWriteOwnedRow(session.profile, c)}
                canReassign={canWriteOwnedRow(session.profile, c)}
                currentUserId={session.profile.id}
                isAdmin={isAdmin}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </PageShell>
  );
}

function pickString(
  value: string | string[] | undefined,
  fallback: string
): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

