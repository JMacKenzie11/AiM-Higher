import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import type { Profile } from "@/lib/types";

// Read model for the "System admins" list on /admin/dashboard.
//
// System admins belong to no company, which is the whole point of the
// role and also the reason they were invisible: every roster surface
// in the app scopes profiles by company_id, so a company-less profile
// appears on none of them. Adding one worked and then vanished. This
// is the one place they are listed.
//
// Email comes from auth.users, not profiles — there is no email
// column on the profile row. That means one lookup per admin through
// the service-role client. It is an N+1, and it is fine here for a
// reason that will not hold if this list ever grows: there are a
// handful of system admins on an instance, by definition, and the
// alternative (paging listUsers until every id is found) reads the
// entire auth table to answer a question about five rows.

export type SystemAdminRow = Pick<
  Profile,
  "id" | "full_name" | "status" | "invited_at" | "created_at"
> & {
  // Null when the auth user is gone but the profile row survived.
  // Shown as a warning in the UI rather than hidden: a profile with
  // no sign-in behind it is a broken account someone has to fix.
  email: string | null;
};

export async function listSystemAdmins(): Promise<SystemAdminRow[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, status, invited_at, created_at")
    .eq("role", "system_admin")
    .order("full_name");

  const rows = (data ?? []) as Array<
    Pick<Profile, "id" | "full_name" | "status" | "invited_at" | "created_at">
  >;
  if (rows.length === 0) return [];

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const emails = await Promise.all(
    rows.map(async (row) => {
      const { data: authUser } = await admin.auth.admin.getUserById(row.id);
      return authUser?.user?.email ?? null;
    })
  );

  return rows.map((row, i) => ({ ...row, email: emails[i] }));
}
