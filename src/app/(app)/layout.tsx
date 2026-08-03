import { NavBand } from "@/components/nav-band/NavBand";
import { HelpWidget } from "@/components/help/HelpWidget";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Company } from "@/lib/types";
import type { ModuleFeature } from "@/lib/subscriptions/service";
import styles from "./layout.module.css";

// Layout for authenticated routes. Guards on session + profile and
// renders the gradient nav band. When a system_admin or aims_guide
// has scoped into a company, the persistent sub-band reads
// "<ROLE LABEL> · COMPANY NAME" per Section 7.

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireProfile();
  const role = session.profile.role;
  const isSystemAdmin = role === "system_admin";
  const isGuide = role === "aims_guide";
  const isCrossCompanyRole = isSystemAdmin || isGuide;

  const roleLabel = isSystemAdmin
    ? "System admin"
    : isGuide
      ? "AiMS Guide"
      : null;

  let contextLabel: string | undefined;
  let scopedCompanyId: string | null = null;
  let scopedCompanyName: string | undefined;

  if (isCrossCompanyRole) {
    scopedCompanyId = await getEffectiveCompanyId(session);
    if (scopedCompanyId) {
      const supabase = await createSupabaseServerClient();
      const { data: company } = await supabase
        .from("companies")
        .select("name")
        .eq("id", scopedCompanyId)
        .maybeSingle<Pick<Company, "name">>();
      scopedCompanyName = company?.name;
      contextLabel = scopedCompanyName
        ? `${roleLabel} · ${scopedCompanyName}`
        : (roleLabel ?? undefined);
    } else {
      contextLabel = roleLabel ?? undefined;
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

  // Fetch the effective company's feature entitlements so NavBand
  // can gate module-specific links. Cross-company roles with no
  // scoped company see no module links either way.
  const effectiveCompanyId = isCrossCompanyRole
    ? scopedCompanyId
    : session.profile.company_id;
  const features: ModuleFeature[] = effectiveCompanyId
    ? await getCompanyFeatures(effectiveCompanyId)
    : [];

  return (
    <div className={styles.frame}>
      <NavBand
        userName={session.profile.full_name}
        isSystemAdmin={isCrossCompanyRole}
        contextLabel={contextLabel}
        showExitScope={isCrossCompanyRole && Boolean(scopedCompanyId)}
        scopedCompanyName={scopedCompanyName}
        features={features}
      />
      <div className={styles.main}>{children}</div>
      <HelpWidget />
    </div>
  );
}
