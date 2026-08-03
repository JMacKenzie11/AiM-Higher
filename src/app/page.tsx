import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";

// Role-based redirect from Section 7:
//   no session                 → /sign-in
//   system_admin (scoped)      → /dashboard
//   system_admin (unscoped)    → /admin/companies picker
//   aims_guide (scoped or single assignment) → /dashboard
//   aims_guide (no scope, multiple assignments) → /admin/companies picker
//   others                     → /dashboard
export default async function RootPage(): Promise<never> {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  if (!session.profile) redirect("/sign-in?error=no-profile");

  const profile = session.profile;
  const role = profile.role;
  if (role === "system_admin" || role === "aims_guide") {
    const scoped = await getEffectiveCompanyId({ profile });
    redirect(scoped ? "/dashboard" : "/admin/companies");
  }
  redirect("/dashboard");
}
