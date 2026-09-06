import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { HelpWidget } from "@/components/help/HelpWidget";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import { deriveCompanyContext } from "@/lib/companies/context-label";
import { getHeaderNotifications } from "@/lib/notifications/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  PostHogProvider,
  type PostHogUser,
} from "@/lib/analytics/PostHogProvider";
import { InstanceProvider } from "@/lib/instances/InstanceProvider";
import { toPublicInstanceConfig } from "@/lib/instances/current";
import type { Company } from "@/lib/types";
import type { ModuleFeature } from "@/lib/subscriptions/service";
import styles from "./layout.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

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

  let scopedCompanyId: string | null = null;

  // Resolve the effective company FIRST, then fetch its row and its
  // entitlements together. Those two have no dependency on each
  // other; they used to run back to back, and this layout renders on
  // every authenticated route, so the extra round trip was paid on
  // every page in the product.
  if (isCrossCompanyRole) {
    scopedCompanyId = await getEffectiveCompanyId(session);
  }
  const effectiveCompanyId = isCrossCompanyRole
    ? scopedCompanyId
    : session.profile.company_id;

  const [companyRow, features] = await Promise.all([
    effectiveCompanyId
      ? (async () => {
          const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
          const { data } = await supabase
            .from("companies")
            .select("name, timezone")
            .eq("id", effectiveCompanyId)
            .maybeSingle<Pick<Company, "name" | "timezone">>();
          return data;
        })()
      : Promise.resolve(null),
    // Feature entitlements gate module-specific nav links. Cross-company
    // roles with no scoped company see no module links either way.
    effectiveCompanyId
      ? getCompanyFeatures(effectiveCompanyId)
      : Promise.resolve([] as ModuleFeature[]),
  ]);

  // Branching lives in lib/companies/context-label.ts so it carries
  // test cover — a server component can't be unit-tested here.
  //
  //   companyTimezone      — the effective company's zone, needed by
  //                          notifications to compute today /
  //                          this-Friday in the right one.
  //   analyticsCompanyName — raw company name for the analytics
  //                          identify call. Kept separate from
  //                          contextLabel because the latter is
  //                          display-formatted ("System admin · Acme
  //                          Co").
  const {
    contextLabel,
    scopedCompanyName,
    analyticsCompanyName,
    companyTimezone,
  } = deriveCompanyContext({
    isCrossCompanyRole,
    roleLabel,
    companyRow: companyRow ?? null,
  });

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
    const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
    const { count } = await supabase
      .from("success_measures")
      .select("id, functions!inner(company_id)", {
        count: "exact",
        head: true,
      })
      .eq("archived", false)
      .eq("functions.company_id", effectiveCompanyId)
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
  // user's preference (no post-hydration jump). Sidebar writes these
  // cookies client-side on toggle.
  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get("nav-collapsed")?.value === "1";
  // Comma-separated list of section-group labels the user has
  // collapsed (e.g. "Disciplines,Strengths"). Empty/unset = all
  // expanded, which is the intended default for a new user.
  const groupsCookie = cookieStore.get("nav-groups-collapsed")?.value ?? "";
  const initialCollapsedGroups = groupsCookie
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const analyticsUser: PostHogUser = {
    id: session.profile.id,
    email: session.email ?? null,
    full_name: session.profile.full_name,
    role: session.profile.role,
    company_id: effectiveCompanyId,
    company_name: analyticsCompanyName,
  };

  return (
    <InstanceProvider config={toPublicInstanceConfig(await getCurrentInstanceConfig())}>
      <PostHogProvider user={analyticsUser}>
        <div
          className={styles.frame}
          data-nav-collapsed={initialCollapsed ? "true" : undefined}
        >
          <Sidebar
            userName={session.profile.full_name}
            userAvatarUrl={session.profile.avatar_url}
            userRole={session.profile.role}
            isSystemAdmin={isCrossCompanyRole}
            contextLabel={contextLabel}
            showExitScope={isCrossCompanyRole && Boolean(scopedCompanyId)}
            scopedCompanyName={scopedCompanyName}
            features={features}
            hasChartMeasures={hasChartMeasures}
            notifications={notifications}
            initialCollapsed={initialCollapsed}
            initialCollapsedGroups={initialCollapsedGroups}
          />
          <div className={styles.main}>{children}</div>
          <HelpWidget />
        </div>
      </PostHogProvider>
    </InstanceProvider>
  );
}
