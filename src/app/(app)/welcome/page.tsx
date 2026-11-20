import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { canWriteOwnedRow, isAdminForCompany } from "@/lib/auth/permissions";
import { getCompanyBasics } from "@/lib/companies/basics";
import { getWelcomeData } from "@/lib/welcome/data";
import { WelcomeBoard } from "./WelcomeBoard";

export const metadata = { title: "Welcome" };

// /welcome: a company's weekly recap page, the Scoreboard design (Jason,
// 2026-11-20). Nothing links here yet and nobody lands here: it is
// reached by typing the address while in a company. The sidebar wears
// the same design on this page only (Sidebar.tsx, data-skin).

export default async function WelcomePage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/");
  const company = await getCompanyBasics(companyId);
  if (!company) redirect("/");
  const timezone = company.timezone ?? "America/Anchorage";

  const data = await getWelcomeData(companyId, session.profile.id, timezone);
  const firstName = session.profile.full_name?.trim().split(/\s+/)[0] || "there";
  const meeting = data.recap?.meeting ?? data.latestMeeting;
  const meetingLine = meeting ? `Your week, from ${meeting.title}, ${meeting.date}` : "Your week at a glance";

  return (
    <WelcomeBoard
      firstName={firstName}
      companyName={company.name}
      meetingLine={meetingLine}
      recap={data.recap}
      followThrough={{
        rate: data.lastWeek.followThrough.rate,
        keptOnTime: data.lastWeek.followThrough.keptOnTime,
        resolved: data.lastWeek.followThrough.resolved,
      }}
      honor={data.lastWeek.honor}
      open={data.open}
      writable={data.open.filter((c) => canWriteOwnedRow(session.profile, c)).map((c) => c.id)}
      todayIso={data.todayIso}
      currentUserId={session.profile.id}
      isAdmin={isAdminForCompany(session.profile, companyId)}
      roster={data.roster}
      priorityOptions={data.priorityOptions}
      functionalAreaOptions={data.functionalAreaOptions}
    />
  );
}
