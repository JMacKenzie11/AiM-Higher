import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { HelpWidget } from "@/components/help/HelpWidget";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import { getHeaderNotifications } from "@/lib/notifications/service";
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
  // Timezone of the effective company — needed by notifications to
  // compute today / this-Friday in the right zone.
  let companyTimezone: string | null = null;

  if (isCrossCompanyRole) {
    scopedCompanyId = await getEffectiveCompanyId(session);
    if (scopedCompanyId) {
      const supabase = await createSupabaseServerClient();
      const { data: company } = await supabase
        .from("companies")
        .select("name, timezone")
        .eq("id", scopedCompanyId)
        .maybeSingle<Pick<Company, "name" | "timezone">>();
      scopedCompanyName = company?.name;
      companyTimezone = company?.timezone ?? null;
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
      .select("name, timezone")
      .eq("id", session.profile.company_id)
      .maybeSingle<Pick<Company, "name" | "timezone">>();
    if (company?.name) contextLabel = company.name;
    companyTimezone = company?.timezone ?? null;
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

  // Companies exploring metrics before flipping the paid Success
  // Tracking entitlement shouldn't get an invisible nav link. When
  // there's at least one measure on the chart, we admit the
  // /measures link even without the entitlement — the tracking
  // side-effects (weekly nudges, mandatory target) still stay off.
  let hasChartMeasures = false;
  if (
    effectiveCompanyId &&
    !features.includes("performance_tracking")
  ) {
    const supabase = await createSupabaseServerClient();
    const { count } = await supabase
      .from("success_measures")
      .select(
        "id, function_outcomes!inner(function_id, functions!inner(company_id))",
        { count: "exact", head: true }
      )
      .eq("archived", false)
      .eq("function_outcomes.functions.company_id", effectiveCompanyId)
      .limit(1);
    hasChartMeasures = (count ?? 0) > 0;
  }

  // Header notifications — computed per request. State-derived, no
  // persistence yet (see lib/notifications/service.ts). Cross-company
  // roles with no scoped company get an empty list; nothing
  // company-level to notify on.
  const notifications = effectiveCompanyId
    ? await getHeaderNotifications({
        userId: session.profile.id,
        companyId: effectiveCompanyId,
        timezone: companyTimezone ?? "America/Anchorage",
        features,
        hasChartMeasures,
      })
    : [];

  // Read persisted collapse state so the initial render matches the
  // user's preference (no post-hydration jump). Sidebar writes this
  // cookie client-side on toggle.
  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get("nav-collapsed")?.value === "1";

  return (
    <div
      className={styles.frame}
      data-nav-collapsed={initialCollapsed ? "true" : undefined}
    >
      <Sidebar
        userName={session.profile.full_name}
        userRole={session.profile.role}
        isSystemAdmin={isCrossCompanyRole}
        contextLabel={contextLabel}
        showExitScope={isCrossCompanyRole && Boolean(scopedCompanyId)}
        scopedCompanyName={scopedCompanyName}
        features={features}
        hasChartMeasures={hasChartMeasures}
        notifications={notifications}
        initialCollapsed={initialCollapsed}
      />
      <div className={styles.main}>{children}</div>
      <HelpWidget />
    </div>
  );
}
