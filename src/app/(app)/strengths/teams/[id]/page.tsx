import { redirect, notFound } from "next/navigation";
import AdminBackLink from "@/components/strengths/AdminBackLink";
import TeamPage from "@/components/strengths/teams/TeamPage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ResultsProfile } from "@/lib/strengths/types";
import type { MissionType } from "@/lib/strengths/team-scoring";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const { data: team } = await supabase
    .from("strengths_teams")
    .select("id, name, mission_type, mission_notes, status, company_id, created_at")
    .eq("id", id)
    .single();
  if (!team) notFound();

  // Back link destination is the Teams list; from there the admin can jump
  // back to the company overview if they need to.
  const isSystemAdmin = me.role === "system_admin";
  const backHref = "/admin/teams";
  const backLabel = "Back to Teams";
  void isSystemAdmin;

  // Roster
  const { data: memberships } = await supabase
    .from("strengths_team_members")
    .select("profile_id, pinned, added_at")
    .eq("team_id", id)
    .order("added_at", { ascending: true });

  // All company people (pool for the eligible list)
  const { data: peopleRaw } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, position")
    .eq("company_id", team.company_id)
    .order("last_name", { ascending: true });
  const people = (peopleRaw ?? []) as {
    id: string;
    first_name: string;
    last_name: string;
    position: string | null;
  }[];

  // Latest completed assessments for everyone in the company
  const { data: assessments } = await supabase
    .from("strengths_assessments")
    .select("id, user_id, status, completed_at")
    .in(
      "user_id",
      people.map((p) => p.id),
    );

  const latestByUser = new Map<string, { id: string; status: string }>();
  for (const a of assessments ?? []) {
    const uid = a.user_id as string;
    const existing = latestByUser.get(uid);
    if (!existing) {
      latestByUser.set(uid, {
        id: a.id as string,
        status: a.status as string,
      });
    }
  }

  const completedIds = Array.from(latestByUser.values())
    .filter((a) => a.status === "completed")
    .map((a) => a.id);
  const { data: results } = completedIds.length
    ? await supabase
        .from("strengths_results")
        .select("assessment_id, profile")
        .in("assessment_id", completedIds)
    : { data: [] as { assessment_id: string; profile: ResultsProfile }[] };

  const resultsByAssessment = new Map<string, ResultsProfile>(
    (results ?? []).map((r) => [
      r.assessment_id as string,
      r.profile as ResultsProfile,
    ]),
  );

  const eligible = people.map((p) => {
    const latest = latestByUser.get(p.id);
    const isCompleted = latest?.status === "completed";
    const profile = isCompleted && latest
      ? resultsByAssessment.get(latest.id) ?? null
      : null;
    return {
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      position: p.position,
      assessment_status: (latest?.status ?? "not_started") as
        | "not_started"
        | "in_progress"
        | "completed",
      profile,
    };
  });

  // Overallocation: count of OTHER active teams each person is on
  const { data: allActiveMemberships } = await supabase
    .from("strengths_team_members")
    .select("profile_id, team_id, teams!inner(status)")
    .in(
      "profile_id",
      people.map((p) => p.id),
    );
  const otherActiveCount = new Map<string, number>();
  for (const row of allActiveMemberships ?? []) {
    const status = (row as { teams?: { status?: string } }).teams?.status;
    if (status === "active" && (row.team_id as string) !== id) {
      const pid = row.profile_id as string;
      otherActiveCount.set(pid, (otherActiveCount.get(pid) ?? 0) + 1);
    }
  }

  // Latest cached evaluation (if any)
  const { data: cached } = await supabase
    .from("strengths_team_evaluations")
    .select("roster_hash, signals, narrative, generated_at")
    .eq("team_id", id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <>
      <div className="hero-shell">
  
        <div className="hero-body">
          <div className="container-wide">
            <div className="eyebrow">Team builder</div>
            <h1 className="hero-title">{team.name}</h1>
            <div className="hero-bar" aria-hidden="true" />
            <p className="hero-sub">
              This shows how energy configures for this mission. It's not a
              ranking, and the final call is yours.
            </p>
            <AdminBackLink href={backHref} label={backLabel} />
          </div>
        </div>
      </div>
      <div className="container-wide content-shell">
        <TeamPage
          teamId={team.id}
          name={team.name}
          missionType={team.mission_type as MissionType}
          missionNotes={team.mission_notes as string | null}
          status={team.status as "draft" | "active" | "archived"}
          roster={(memberships ?? []).map((m) => ({
            profile_id: m.profile_id as string,
            pinned: m.pinned as boolean,
          }))}
          eligible={eligible}
          otherActiveTeams={Object.fromEntries(otherActiveCount)}
          initialEvaluation={
            cached
              ? {
                  roster_hash: cached.roster_hash as string,
                  narrative: (cached.narrative as string | null) ?? null,
                }
              : null
          }
        />
      </div>
    </>
  );
}
