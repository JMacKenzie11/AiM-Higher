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
import { ResolvedIssuesList } from "./ResolvedIssuesList";
import shellStyles from "../admin/companies/admin.module.css";

// Issues/Solutions — the Solution Seeking discipline. Name the
// issue, decide what you want, and commit to the next step. Ranks
// live inline (drag-to-reorder); resolved issues collapse to a
// muted list beneath.

export default async function IssuesPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

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

  return (
    <PageShell
      eyebrow="Company"
      title="Issues/Solutions"
      subtitle="Name it, decide what you want, and commit to the next step."
    >
      <section className={shellStyles.card} aria-labelledby="issues-add">
        <h2 id="issues-add" className={shellStyles.h2}>
          Add an issue
        </h2>
        <CreateIssueRow />
      </section>

      <section className={shellStyles.card} aria-labelledby="issues-open">
        <h2 id="issues-open" className={shellStyles.h2}>
          Open issues
        </h2>
        <IssuesBoard
          issues={data.open}
          roster={roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
          priorityOptions={priorityOptions}
          functionalAreaOptions={functionalAreaOptions}
          todayIso={todayIso}
          currentUserId={session.profile.id}
          currentUserCompanyId={session.profile.company_id}
          isAdmin={isAdmin}
        />
      </section>

      {data.resolved.length > 0 ? (
        <section
          className={shellStyles.card}
          aria-labelledby="issues-resolved"
        >
          <h2 id="issues-resolved" className={shellStyles.h2}>
            Resolved issues
          </h2>
          <ResolvedIssuesList items={data.resolved} />
        </section>
      ) : null}
    </PageShell>
  );
}
