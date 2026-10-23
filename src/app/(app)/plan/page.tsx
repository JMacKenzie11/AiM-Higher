import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { PageShell } from "@/components/ui/PageShell";
import { PlanView } from "./PlanView";

export const metadata = { title: "Goals & Priorities" };

// Plan workspace — Section 8.3. The page is its header and PlanView,
// which the weekly meeting's Strategy step renders too.

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function PlanPage({ searchParams }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const { q } = await searchParams;

  return (
    <PageShell
      eyebrow="Company"
      title="Goals & Priorities"
      subtitle="The cascade for your company, one quarter at a time."
    >
      <PlanView session={session} companyId={companyId} q={q} />
    </PageShell>
  );
}
