import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { PageShell } from "@/components/ui/PageShell";
import { IssuesView } from "./IssuesView";

export const metadata = { title: "Issues/Solutions" };

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

  return (
    <PageShell
      eyebrow="Company"
      title="Issues/Solutions"
      subtitle="Name it, decide what you want, and commit to the next step."
    >
      <IssuesView session={session} companyId={companyId} searchParams={await searchParams} />
    </PageShell>
  );
}
