import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getIssuesPageData } from "@/lib/issues/service";
import { todayInTimezone } from "@/lib/dates";
import type { Profile } from "@/lib/types";
import { PageShell } from "@/components/ui/PageShell";
import { IssuesBoard } from "./IssuesBoard";
import { CreateIssueRow } from "./CreateIssueRow";
import { ResolvedIssuesList } from "./ResolvedIssuesList";
import styles from "./issues.module.css";

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

  const data = await getIssuesPageData(companyId);

  // Roster feeds the owner picker on the inline commitment add row.
  const { data: rosterRows } = await supabase
    .from("profiles")
    .select("id, full_name, position")
    .eq("company_id", companyId)
    .neq("status", "inactive")
    .order("full_name");
  const roster = (rosterRows ?? []) as Array<
    Pick<Profile, "id" | "full_name" | "position">
  >;

  const isAdmin = isAdminForCompany(session.profile, companyId);

  return (
    <PageShell
      eyebrow="Company"
      title="Issues/Solutions"
      subtitle="Name it, decide what you want, and commit to the next step."
    >
      <div className={styles.stage}>
        <CreateIssueRow />

        <IssuesBoard
          issues={data.open}
          roster={roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
          todayIso={todayIso}
          currentUserId={session.profile.id}
          currentUserCompanyId={session.profile.company_id}
          isAdmin={isAdmin}
        />

        {data.resolved.length > 0 ? (
          <ResolvedIssuesList items={data.resolved} />
        ) : null}
      </div>
    </PageShell>
  );
}
