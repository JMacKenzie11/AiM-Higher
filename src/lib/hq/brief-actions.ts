"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { generateSessionBrief, type SessionBriefResult } from "./brief";

// Server action wrapper for the "Prepare for {company}" button on
// Guide HQ. Only sysadmin + aims_guide roles reach this — Guide HQ
// itself is behind the same guard, so any client-triggered call
// already comes from a caller with the right role. The brief.ts
// generator runs the RLS-scoped insert against session_briefs so
// non-sysadmin callers can only insert on companies they hold a
// guide assignment for.

export async function generateSessionBriefAction(
  companyId: string
): Promise<SessionBriefResult> {
  const session = await requireRole(["system_admin", "aims_guide"]);
  const result = await generateSessionBrief(companyId, session.profile.id);
  if (result.ok) {
    revalidatePath("/hq");
    revalidatePath(`/admin/guides/${session.profile.id}/hq`);
  }
  return result;
}
