import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { Suspense } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { OpenCommitmentFromLink } from "@/components/work-drawer/OpenCommitmentFromLink";
import { OtherCompanyNotice, linkCompanyFrom, openIdFrom } from "../commitments/OtherCompanyNotice";
import { IssuesView } from "./IssuesView";

export const metadata = { title: "Issues" };

// Issues/Solutions — the Solution Seeking discipline. Name the
// issue, decide what you want, and commit to the next step. The page
// is its header and IssuesView, which the weekly meeting's Solve step
// renders too.

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function IssuesPage({ searchParams }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");
  const sp = await searchParams;
  const openId = openIdFrom(sp);

  return (
    <PageShell
      eyebrow="Company"
      title="Issues"
      subtitle="Name it, decide what you want, and commit to the next step."
    >
      <OtherCompanyNotice
        session={session}
        companyId={companyId}
        linkCompanyId={linkCompanyFrom(sp)}
        destination={openId ? `/issues?open=${openId}` : "/issues"}
      />
      <Suspense fallback={null}>
        <OpenCommitmentFromLink />
      </Suspense>
      <IssuesView session={session} companyId={companyId} searchParams={sp} />
    </PageShell>
  );
}
