import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Read model for the "Assigned access" card on a company's admin page
// (/admin/companies/[id]). Product spec §1a, decision 9.
//
// These are the people who administer a company without being part of
// its team: AiMS Guides assigned to it, and portfolio admins who hold
// an assignment for it. They do NOT appear on /people. That was the
// earlier design (decisions 6 and 8, superseded) and it put two
// non-members into the page every employee reads to find out who
// their colleagues are, then explained the discrepancy to all of them
// with a badge. The people who need to know about outside access are
// the ones who administer the company, and this is their page.
//
// THE LIST COMES FROM THE DATABASE, NOT FROM A QUERY HERE.
// assigned_access() (migration 0201) is SECURITY DEFINER and carries
// its own guard: a system_admin, a portfolio_admin, or the
// company_admin of the company being asked about. Anyone else gets an
// empty result, which is the same answer as a company with nobody
// assigned.
//
// It is a function rather than three widened policies because the
// third of those would be profiles_select — the policy deciding who
// can read a person anywhere in the product — and an assigned guide's
// profile has a null company_id, so a company admin cannot read their
// name. Widening that to render a card is not a trade worth making.

export type AssignedAccessKind = "guide" | "portfolio";

export type AssignedAccessRow = {
  profileId: string;
  fullName: string;
  kind: AssignedAccessKind;
  // Null when the auth user is gone but the profile row survived, the
  // same way the platform admin list treats it: shown rather than
  // hidden, because a profile with no sign-in behind it is a broken
  // account somebody has to fix.
  email: string | null;
};

export async function getAssignedAccess(
  companyId: string
): Promise<AssignedAccessRow[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data } = await supabase.rpc("assigned_access", {
    target_company_id: companyId,
  });

  const rows = (data ?? []) as Array<{
    profile_id: string;
    full_name: string;
    kind: AssignedAccessKind;
  }>;
  if (rows.length === 0) return [];

  // Email lives on auth.users, not on the profile row, so this is one
  // lookup per person through the service-role client. Same N+1 as
  // the platform admin list and fine for the same reason: a company
  // has a handful of assigned people at most, and the alternative is
  // paging the whole auth table to answer a question about three
  // rows.
  //
  // The ids are the ones the database just returned for THIS company
  // through a guarded function, so the privileged client is only ever
  // asked about people already proven to be assigned here.
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const emails = await Promise.all(
    rows.map(async (row) => {
      const { data: authUser } = await admin.auth.admin.getUserById(
        row.profile_id
      );
      return authUser?.user?.email ?? null;
    })
  );

  return rows.map((row, i) => ({
    profileId: row.profile_id,
    fullName: row.full_name,
    kind: row.kind,
    email: emails[i],
  }));
}
