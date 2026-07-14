import { NavBand } from "@/components/nav-band/NavBand";
import { requireProfile } from "@/lib/auth/current-user";
import { getScopedCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Company } from "@/lib/types";
import styles from "./layout.module.css";

// Layout for authenticated routes. Guards on session + profile and
// renders the gradient nav band. When a system_admin has scoped into
// a company (Phase 8), the persistent sub-band reads
// "SYSTEM ADMIN · COMPANY NAME" per Section 7.

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireProfile();
  const isSystemAdmin = session.profile.role === "system_admin";

  let contextLabel: string | undefined;
  let scopedCompanyId: string | null = null;
  let scopedCompanyName: string | undefined;

  if (isSystemAdmin) {
    scopedCompanyId = await getScopedCompanyId();
    if (scopedCompanyId) {
      const supabase = await createSupabaseServerClient();
      const { data: company } = await supabase
        .from("companies")
        .select("name")
        .eq("id", scopedCompanyId)
        .maybeSingle<Pick<Company, "name">>();
      scopedCompanyName = company?.name;
      contextLabel = scopedCompanyName
        ? `System admin · ${scopedCompanyName}`
        : "System admin";
    } else {
      contextLabel = "System admin";
    }
  } else if (session.profile.company_id) {
    const supabase = await createSupabaseServerClient();
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", session.profile.company_id)
      .maybeSingle<Pick<Company, "name">>();
    if (company?.name) contextLabel = company.name;
  }

  return (
    <div className={styles.frame}>
      <NavBand
        userName={session.profile.full_name}
        isSystemAdmin={isSystemAdmin}
        contextLabel={contextLabel}
        showExitScope={isSystemAdmin && Boolean(scopedCompanyId)}
        scopedCompanyName={scopedCompanyName}
      />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
