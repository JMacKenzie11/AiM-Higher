"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import {
  clearScopedCompanyCookie,
  setScopedCompanyCookie,
} from "./scope";

// Server actions callable from Client Components.

export async function scopeIntoCompanyAction(
  companyId: string,
  redirectTo: string = "/dashboard"
): Promise<never> {
  const session = await requireRole(["system_admin"]);
  await setScopedCompanyCookie(companyId, session.profile.role);
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function exitCompanyScopeAction(): Promise<never> {
  await requireRole(["system_admin"]);
  await clearScopedCompanyCookie();
  revalidatePath("/", "layout");
  redirect("/admin/companies");
}
