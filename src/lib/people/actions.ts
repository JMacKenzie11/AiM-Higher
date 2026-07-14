"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// People-management actions used by /people (Section 8.6) and /profile.
// Editing anyone else's profile is admin-only. Self-edit is allowed for
// any role but limited to name + position (role is preserved from the
// current session — self can't change own role, mirroring RLS
// profiles_update_self).

export type ProfileResult =
  | { ok: true; profile: Profile }
  | { ok: false; message: string };

export async function updateProfileAction(
  _prev: ProfileResult | undefined,
  formData: FormData
): Promise<ProfileResult> {
  const session = await requireProfile();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing profile id." };

  const fullName = String(formData.get("full_name") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim() || null;
  if (!fullName) return { ok: false, message: "Name is required." };

  const isSelf = id === session.profile.id;
  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  if (!isSelf && !isAdmin) {
    return { ok: false, message: "You can't edit that profile." };
  }

  // Role handling. Self-edit: always preserve the caller's current role.
  // Admin-edit of someone else: honor the submitted role, with the
  // company_admin restriction (mirrors profiles_update_company_admin RLS).
  let roleToWrite: Profile["role"] = session.profile.role;
  if (!isSelf) {
    const roleRaw = String(formData.get("role") ?? "").trim();
    if (
      session.profile.role === "company_admin" &&
      !(roleRaw === "team_member" || roleRaw === "company_admin")
    ) {
      return { ok: false, message: "Company admins can't grant that role." };
    }
    roleToWrite =
      roleRaw === "system_admin" ||
      roleRaw === "company_admin" ||
      roleRaw === "team_member"
        ? (roleRaw as Profile["role"])
        : "team_member";
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, position, role: roleToWrite })
    .eq("id", id)
    .select("*")
    .single<Profile>();
  if (error || !data) {
    return { ok: false, message: "Couldn't save that profile." };
  }

  revalidatePath("/people");
  revalidatePath(`/people/${id}`);
  revalidatePath("/profile");
  revalidatePath("/", "layout"); // NavBand shows user name
  return { ok: true, profile: data };
}

export async function setProfileStatusAction(
  personId: string,
  status: "active" | "inactive"
): Promise<ProfileResult> {
  await requireRole(["system_admin", "company_admin"]);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ status })
    .eq("id", personId)
    .select("*")
    .single<Profile>();
  if (error || !data) {
    return {
      ok: false,
      message: "Couldn't update that person's status.",
    };
  }

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  return { ok: true, profile: data };
}
