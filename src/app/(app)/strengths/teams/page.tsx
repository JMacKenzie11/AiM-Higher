import { redirect } from "next/navigation";
import Link from "next/link";
import AdminBackLink from "@/components/strengths/AdminBackLink";
import CreateTeamForm from "@/components/strengths/teams/CreateTeamForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MISSION_LABELS } from "@/lib/strengths/team-labels";
import type { MissionType } from "@/lib/strengths/team-scoring";
import styles from "../strengths.module.css";

type TeamRow = {
  id: string;
  name: string;
  mission_type: MissionType;
  status: "draft" | "active" | "archived";
  company_id: string;
  created_at: string;
};

export default async function TeamsListPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id")
    .eq("id", user.id)
    .single();
  if (!me) redirect("/");
  if (me.role !== "company_admin" && me.role !== "system_admin") {
    redirect("/");
  }

  const { data: teams } = await supabase
    .from("strengths_teams")
    .select("id, name, mission_type, status, company_id, created_at")
    .order("created_at", { ascending: false });

  const teamRows = (teams ?? []) as TeamRow[];

  // Company info for system admin (badge on each team) and for the create form.
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .order("name", { ascending: true });
  const companyById = new Map(
    (companies ?? []).map((c) => [c.id as string, c.name as string]),
  );

  const isSystemAdmin = me.role === "system_admin";

  // Back link destination:
  //  - company admin → their own company overview
  //  - system admin → if every team on the list belongs to the same
  //    company, return the admin to that specific company's overview;
  //    otherwise fall back to the companies list.
  const myCompanyName = me.company_id
    ? companyById.get(me.company_id) ?? ""
    : "";

  let backHref = "/admin/companies";
  let backLabel = `Back to ${myCompanyName || "Companies"}`;
  if (isSystemAdmin) {
    const distinctCompanyIds = new Set(teamRows.map((t) => t.company_id));
    if (distinctCompanyIds.size === 1) {
      const onlyId = Array.from(distinctCompanyIds)[0];
      const onlyName = companyById.get(onlyId) ?? "company";
      backHref = `/admin/companies/${onlyId}`;
      backLabel = `Back to ${onlyName}`;
    } else {
      backHref = "/admin/companies";
      backLabel = "Back to Companies";
    }
  }

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Team builder">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Team builder</p>
          <h1 className={styles.h1}>Teams</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Assemble a team for a mission and see how energy configures for it.
            It&rsquo;s not a ranking — the final call is yours.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        {isSystemAdmin ? <AdminBackLink href={backHref} label={backLabel} /> : null}

        <section className={styles.card} aria-labelledby="teams-list">
          <div className={styles.cardHeader}>
            <h2 id="teams-list" className={styles.h2}>
              Your teams
            </h2>
            <div className={styles.cardHeaderMeta}>
              <Link href="/strengths/teams/recommend" className={styles.ghostButton}>
                Recommend a team
              </Link>
              <span>
                {teamRows.length} {teamRows.length === 1 ? "team" : "teams"}
              </span>
            </div>
          </div>
          {teamRows.length === 0 ? (
            <p className={styles.muted}>
              No teams yet. Create one below and start composing.
            </p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mission</th>
                  <th>Status</th>
                  {isSystemAdmin ? <th>Company</th> : null}
                  <th className={styles.tableActionCell}></th>
                </tr>
              </thead>
              <tbody>
                {teamRows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link
                        href={`/strengths/teams/${t.id}`}
                        className={styles.tableLink}
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className={styles.tableMuted}>
                      {MISSION_LABELS[t.mission_type] ?? t.mission_type}
                    </td>
                    <td>
                      <span className={`${styles.chip} ${chipClass(t.status)}`}>
                        {t.status[0].toUpperCase() + t.status.slice(1)}
                      </span>
                    </td>
                    {isSystemAdmin ? (
                      <td className={styles.tableMuted}>
                        {companyById.get(t.company_id) ?? ""}
                      </td>
                    ) : null}
                    <td className={styles.tableActionCell}>
                      <Link
                        href={`/strengths/teams/${t.id}`}
                        className={styles.ghostButton}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.card} aria-labelledby="create-team">
          <div className={styles.cardHeader}>
            <h2 id="create-team" className={styles.h2}>
              Create a team
            </h2>
          </div>
          <CreateTeamForm
            lockedCompanyId={
              me.role === "company_admin" ? me.company_id : null
            }
            companies={
              isSystemAdmin
                ? (companies ?? []).map((c) => ({
                    id: c.id as string,
                    name: c.name as string,
                  }))
                : []
            }
          />
        </section>
      </div>
    </div>
  );
}

function chipClass(status: TeamRow["status"]): string {
  if (status === "active") return styles.chipPrimary;
  if (status === "draft") return styles.chipSky;
  return styles.chipMuted;
}
