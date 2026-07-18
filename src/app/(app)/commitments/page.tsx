import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { canWriteOwnedRow } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import {
  getCommitmentsPageData,
  type CommitmentFilters,
} from "@/lib/commitments/service";
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
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Commitments</h1>
        <span className="aims-rule" aria-hidden="true" />
        <p className={styles.subtitle}>Every agreement, in one place.</p>

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
            <span className={styles.statPillLabel}>Follow-through rate this quarter</span>
          </span>
        </div>

        {!data.openQuarter ? (
          <div className={styles.noticeCard}>
            <p className={styles.noticeText}>
              No open quarter yet. Priorities live inside a quarter.
            </p>
            {isAdmin ? (
              <Link href="/quarters" className={styles.primaryLink}>
                Open this quarter →
              </Link>
            ) : null}
          </div>
        ) : null}
      </header>

      <FilterPills
        currentUserId={session.profile.id}
        roster={data.roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
        owner={filters.owner}
        status={filters.status}
        type={filters.type}
      />

      <section className={styles.group} aria-labelledby="commitments-main">
        <div className={styles.groupHeader}>
          <h2 id="commitments-main" className={styles.groupTitle}>
            Commitments
          </h2>
          <span className={styles.groupMeta}>
            {data.mainList.length}{" "}
            {data.mainList.length === 1 ? "commitment" : "commitments"}
          </span>
        </div>
        <ul className={styles.rowList}>
          {data.mainList.length === 0 ? (
            <li className={styles.emptyLine}>
              Nothing here yet — add the first below.
            </li>
          ) : (
            data.mainList.map((c) => (
              <CommitmentRow
                key={c.id}
                commitment={c}
                priorityOptions={data.priorityOptions}
                todayIso={data.todayIso}
                canResolve={canWriteOwnedRow(session.profile, c)}
                canLink={canWriteOwnedRow(session.profile, c)}
              />
            ))
          )}
        </ul>
        <InlineAddRow
          thisFriday={data.thisFriday}
          priorityOptions={data.priorityOptions}
          roster={data.roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
          currentUserId={session.profile.id}
          isAdmin={isAdmin}
          quarterCoversThisWeek={data.quarterCoversThisWeek}
          noQuarterMessage={noQuarterMessage}
        />
      </section>

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
                todayIso={data.todayIso}
                currentUserId={session.profile.id}
                isAdmin={isAdmin}
                currentUserCompanyId={session.profile.company_id}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function pickString(
  value: string | string[] | undefined,
  fallback: string
): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

