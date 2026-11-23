"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { insertNotification } from "@/lib/notifications/service";
import { canManageCoachingCallAccess } from "./access";

// WHO CAN SEE COACHING CALLS, MANAGED (0329; Jason, 2026-11-23).
//
// Add or remove a person at the company in scope. Allowed: an assigned
// coach (aims_guide or system_admin with a guide_assignments row) or a
// company admin (an active company_admin of the company, or a portfolio
// admin a system admin switched on as its admin). Written through the
// caller's own client, so the list's write rules decide as well: the
// person must be an active member of the company, and the row is
// signed by the caller. The company is the caller's scoped company,
// never a form value.

export type AccessResult = { ok: true } | { ok: false; message: string };

export async function addCoachingCallViewerAction(profileId: string): Promise<AccessResult> {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) return { ok: false, message: "Choose a company first." };
  if (!profileId) return { ok: false, message: "Choose someone to add." };
  if (!(await canManageCoachingCallAccess(companyId))) {
    return { ok: false, message: "Only the company's coach or an admin can change who sees coaching calls." };
  }

  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: person } = await db
    .from("profiles")
    .select("id, full_name, company_id, status")
    .eq("id", profileId)
    .maybeSingle<{ id: string; full_name: string | null; company_id: string | null; status: string }>();
  if (!person || person.company_id !== companyId || person.status !== "active") {
    return { ok: false, message: "That person isn't on this company's team." };
  }

  const { error } = await db
    .from("coaching_call_viewers")
    .insert({ company_id: companyId, profile_id: profileId, added_by: session.profile.id });
  if (error) {
    // Already on the list: the same outcome the person asked for.
    if (error.code === "23505") return { ok: true };
    console.error("[coaching-calls] add viewer failed:", error.message);
    return { ok: false, message: "Couldn't add them. Try again." };
  }

  const by = session.profile.full_name?.trim() || "Your coach";
  const notified = await insertNotification({
    recipientId: profileId,
    companyId,
    kind: "coaching-access",
    eyebrow: "Coaching calls",
    title: `${by} gave you access to the coaching calls.`,
    href: "/leadership#coaching-calls",
    createdBy: session.profile.id,
  });
  if (!notified.ok && notified.message !== "skipped self-notification") {
    console.warn("[coaching-calls] notification failed:", notified.message);
  }

  revalidatePath("/leadership");
  return { ok: true };
}

export async function removeCoachingCallViewerAction(profileId: string): Promise<AccessResult> {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) return { ok: false, message: "Choose a company first." };
  if (!(await canManageCoachingCallAccess(companyId))) {
    return { ok: false, message: "Only the company's coach or an admin can change who sees coaching calls." };
  }

  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { error } = await db
    .from("coaching_call_viewers")
    .delete()
    .eq("company_id", companyId)
    .eq("profile_id", profileId);
  if (error) {
    console.error("[coaching-calls] remove viewer failed:", error.message);
    return { ok: false, message: "Couldn't remove them. Try again." };
  }

  revalidatePath("/leadership");
  return { ok: true };
}
