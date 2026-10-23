import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { PageShell } from "@/components/ui/PageShell";
import { CommitmentsView, commitmentFiltersFrom } from "./CommitmentsView";

export const metadata = { title: "Functional Commitments" };

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

  return (
    <PageShell
      eyebrow="Company"
      title="Functional Commitments"
      subtitle="Every agreement, in one place."
    >
      <CommitmentsView
        session={session}
        companyId={companyId}
        filters={commitmentFiltersFrom(await searchParams)}
      />
    </PageShell>
  );
}
