import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { weekLabel } from "@/lib/measures/months";
import { PageShell } from "@/components/ui/PageShell";
import { MeasuresView, loadMeasuresView } from "./MeasuresView";

export const metadata = { title: "Critical Success Factors" };

// Critical Success Factors: the spreadsheet, in the app. The page is
// its header and MeasuresView, which the weekly meeting's Numbers step
// renders too.
//
// The tracking columns disappear when the company does not have
// Success Tracking on, and the page becomes a pure authoring
// surface.

export default async function MeasuresPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const data = await loadMeasuresView(session, companyId);

  return (
    <PageShell
      eyebrow="Company"
      title="Critical Success Factors"
      subtitle={
        <>
          Every function&rsquo;s critical success factors. Log{" "}
          {weekLabel(data.weekEnding)} for the functions you lead.
        </>
      }
    >
      <MeasuresView data={data} />
    </PageShell>
  );
}
