import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { Suspense } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { OpenCommitmentFromLink } from "@/components/work-drawer/OpenCommitmentFromLink";
import { OtherCompanyNotice, linkCompanyFrom, openIdFrom } from "./OtherCompanyNotice";
import { CommitmentsView, commitmentFiltersFrom } from "./CommitmentsView";

export const metadata = { title: "Commitments" };

// /commitments — one page, grouped by week, replacing /weekly-review.
// The page is its header and CommitmentsView, which the weekly
// meeting's Commitments step renders too.

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommitmentsPage({ searchParams }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  const sp = await searchParams;
  const openId = openIdFrom(sp);

  return (
    <PageShell
      eyebrow="Company"
      title="Commitments"
      subtitle="Every agreement, in one place."
    >
      <OtherCompanyNotice
        session={session}
        companyId={companyId}
        linkCompanyId={linkCompanyFrom(sp)}
        destination={openId ? `/commitments?open=${openId}` : "/commitments"}
      />
      <Suspense fallback={null}>
        <OpenCommitmentFromLink />
      </Suspense>
      <CommitmentsView
        session={session}
        companyId={companyId}
        filters={commitmentFiltersFrom(sp)}
      />
    </PageShell>
  );
}
