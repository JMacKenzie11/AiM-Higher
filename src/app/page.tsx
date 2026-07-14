import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/current-user";
import { getScopedCompanyId } from "@/lib/admin/scope";

// Role-based redirect from Section 7:
//   no session          → /sign-in
//   system_admin (scoped)   → /dashboard   (they've picked a company)
//   system_admin (unscoped) → /admin/companies
//   others              → /dashboard
export default async function RootPage(): Promise<never> {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  if (!session.profile) redirect("/sign-in?error=no-profile");

  if (session.profile.role === "system_admin") {
    const scoped = await getScopedCompanyId();
    redirect(scoped ? "/dashboard" : "/admin/companies");
  }
  redirect("/dashboard");
}
