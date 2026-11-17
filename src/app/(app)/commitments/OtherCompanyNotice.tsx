import type { requireProfile } from "@/lib/auth/current-user";
import { roleUsesCompanyScope } from "@/lib/admin/scope-request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { ScopeIntoCompanyButton } from "../admin/companies/ScopeIntoCompanyButton";
import styles from "./commitments.module.css";

export { linkCompanyFrom, openIdFrom } from "@/lib/commitments/link";

// A link into one company's commitment (?company=<id>, the weekly
// meeting email's) opened by a Coach or admin who is looking at a
// different company. Visiting a URL never switches company (see
// scope-request.ts), so this says where the commitment is and offers
// the switch as a button, which lands back on the same link.
//
// Nothing for anyone whose company is their own, or when the link's
// company is not one they can read: the select runs as the caller.
type Session = Awaited<ReturnType<typeof requireProfile>>;

export async function OtherCompanyNotice({
  session,
  companyId,
  linkCompanyId,
  destination,
}: {
  session: Session;
  companyId: string;
  linkCompanyId: string | null;
  destination: string;
}) {
  if (!linkCompanyId || linkCompanyId === companyId) return null;
  if (!roleUsesCompanyScope(session.profile.role)) return null;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await supabase
    .from("companies")
    .select("name")
    .eq("id", linkCompanyId)
    .maybeSingle<{ name: string }>();
  if (!data) return null;

  return (
    <div className={styles.noticeCard} role="status">
      <p className={styles.noticeText}>This commitment is in {data.name}.</p>
      <ScopeIntoCompanyButton
        companyId={linkCompanyId}
        destination={destination}
        className={styles.switchButton}
      >
        Switch to {data.name}
      </ScopeIntoCompanyButton>
    </div>
  );
}
