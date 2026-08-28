import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getIssuesPageData } from "@/lib/issues/service";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { todayInTimezone } from "@/lib/dates";
import type { Priority, Profile } from "@/lib/types";
import { PageShell } from "@/components/ui/PageShell";
import { IssuesBoard } from "./IssuesBoard";
import { CreateIssueRow } from "./CreateIssueRow";
import { FilterPills } from "./FilterPills";
import { ResolvedIssuesList } from "./ResolvedIssuesList";
import commitmentStyles from "../commitments/commitments.module.css";

// Issues/Solutions — the Solution Seeking discipline. Name the
// issue, decide what you want, and commit to the next step. Ranks
// live inline (drag-to-reorder); resolved issues collapse to a
// muted list beneath.

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type IssueFilters = {
  assignedTo: "all" | "me" | string;
  status: "all" | "open" | "resolved";
  source: "all" | "meeting" | "manual";
};

export default async function IssuesPage({ searchParams }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const sp = await searchParams;
  const filters: IssueFilters = {
    assignedTo: pickString(sp.assigned, "all"),
    status: pickString(sp.status, "all") as IssueFilters["status"],
    source: pickString(sp.source, "all") as IssueFilters["source"],
  };

  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const timezone = company?.timezone ?? "America/Anchorage";
  const { iso: todayIso } = todayInTimezone(timezone);

  const [data, openQuarter] = await Promise.all([
    getIssuesPageData(companyId),
    getCurrentQuarter(companyId),
  ]);

  // Roster feeds the owner picker on the inline commitment add row.
  // Priority + functional area options feed the LinkChip menu on
  // each issue-linked commitment so a user can re-target the link
  // (switch off the issue to a priority or functional area).
  const [{ data: rosterRows }, { data: priorityRows }, { data: fnRows }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, position")
        .eq("company_id", companyId)
        .neq("status", "inactive")
        .order("full_name"),
      openQuarter
        ? supabase
            .from("priorities")
            .select("id, title")
            .eq("company_id", companyId)
            .eq("quarter_id", openQuarter.id)
            .eq("archived", false)
            .order("title")
        : Promise.resolve({ data: [] as Array<Pick<Priority, "id" | "title">> }),
      supabase
        .from("functions")
        .select("id, title")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("title"),
    ]);
  const roster = (rosterRows ?? []) as Array<
    Pick<Profile, "id" | "full_name" | "position">
  >;
  const priorityOptions = (priorityRows ?? []) as Array<
    Pick<Priority, "id" | "title">
  >;
  const functionalAreaOptions = (fnRows ?? []) as Array<{
    id: string;
    title: string;
  }>;

  const isAdmin = isAdminForCompany(session.profile, companyId);

  // Header stats computed against the unfiltered dataset — the pills
  // report the company-wide state; filter pills below let the reader
  // narrow the visible list without moving the counts.
  const openCount = data.open.length;
  const noCommitmentCount = data.open.filter(
    (i) => i.commitments.filter((c) => c.status === "open").length === 0
  ).length;
  const resolvedThisQuarter = openQuarter
    ? data.resolved.filter(
        (r) =>
          r.resolved_at !== null &&
          r.resolved_at.slice(0, 10) >= openQuarter.start_date &&
          r.resolved_at.slice(0, 10) <= openQuarter.end_date
      ).length
    : 0;

  // Apply filters. Source + Assigned-to run against both open and
  // resolved lists; Status decides which sections render at all.
  const filteredOpen = data.open.filter((issue) => {
    if (!matchesSource(issue.source_meeting_id, filters.source)) return false;
    if (filters.assignedTo === "all") return true;
    const targetId =
      filters.assignedTo === "me" ? session.profile.id : filters.assignedTo;
    return issue.commitments.some((c) => c.owner_id === targetId);
  });
  const filteredResolved = data.resolved.filter((issue) => {
    if (!matchesSource(issue.source_meeting_id, filters.source)) return false;
    if (filters.assignedTo === "all") return true;
    const targetId =
      filters.assignedTo === "me" ? session.profile.id : filters.assignedTo;
    return issue.commitments.some((c) => c.owner_id === targetId);
  });

  const showOpenSection = filters.status !== "resolved";
  const showResolvedSection =
    filters.status !== "open" && filteredResolved.length > 0;

  return (
    <PageShell
      eyebrow="Company"
      title="Issues/Solutions"
      subtitle="Name it, decide what you want, and commit to the next step."
    >
      <div className={commitmentStyles.statBar}>
        <span className={commitmentStyles.statPill}>
          <span
            className={`${commitmentStyles.statPillValue} aims-tabular`}
          >
            {openCount}
          </span>
          <span className={commitmentStyles.statPillLabel}>Open</span>
        </span>
        <span className={commitmentStyles.statPill}>
          <span
            className={`${commitmentStyles.statPillValue} aims-tabular`}
          >
            {noCommitmentCount}
          </span>
          <span className={commitmentStyles.statPillLabel}>
            No commitment yet
          </span>
        </span>
        <span className={commitmentStyles.statPill}>
          <span
            className={`${commitmentStyles.statPillValue} aims-tabular`}
          >
            {resolvedThisQuarter}
          </span>
          <span className={commitmentStyles.statPillLabel}>
            Resolved this quarter
          </span>
        </span>
      </div>

      <FilterPills
        currentUserId={session.profile.id}
        roster={roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
        assignedTo={filters.assignedTo}
        status={filters.status}
        source={filters.source}
      />

      {showOpenSection ? (
        <section
          className={commitmentStyles.group}
          aria-labelledby="issues-open"
        >
          <div className={commitmentStyles.groupHeader}>
            <h2 id="issues-open" className={commitmentStyles.groupTitle}>
              Open issues
            </h2>
            <span className={commitmentStyles.groupMeta}>
              {filteredOpen.length}{" "}
              {filteredOpen.length === 1 ? "issue" : "issues"}
            </span>
          </div>
          <IssuesBoard
            issues={filteredOpen}
            roster={roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
            priorityOptions={priorityOptions}
            functionalAreaOptions={functionalAreaOptions}
            todayIso={todayIso}
            currentUserId={session.profile.id}
            currentUserCompanyId={session.profile.company_id}
            isAdmin={isAdmin}
          />
          <CreateIssueRow />
        </section>
      ) : null}

      {showResolvedSection ? (
        <section
          className={commitmentStyles.group}
          aria-labelledby="issues-resolved"
        >
          <div className={commitmentStyles.groupHeader}>
            <h2 id="issues-resolved" className={commitmentStyles.groupTitle}>
              Resolved issues
            </h2>
            <span className={commitmentStyles.groupMeta}>
              {filteredResolved.length}{" "}
              {filteredResolved.length === 1 ? "issue" : "issues"}
            </span>
          </div>
          <ResolvedIssuesList
            items={filteredResolved}
            roster={roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
          />
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

function matchesSource(
  sourceMeetingId: string | null,
  filter: IssueFilters["source"]
): boolean {
  if (filter === "all") return true;
  if (filter === "meeting") return sourceMeetingId !== null;
  return sourceMeetingId === null;
}
