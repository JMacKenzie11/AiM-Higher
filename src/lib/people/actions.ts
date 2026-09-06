"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

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

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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

// ---- Avatar upload ----
//
// Any signed-in user can update their OWN avatar. The crop UI hands us
// a cropped square image blob (typically PNG, ~256..512px). We upload
// to the public profile-avatars bucket under <user_id>/<uuid>.png and
// set avatar_url on the profile row. Storage RLS gates by folder =
// caller UID as defence-in-depth over the app-layer check here.

const AVATAR_MIME_ALLOWLIST = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function uploadAvatarAction(
  formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const session = await requireProfile();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Pick a photo first." };
  }
  if (!AVATAR_MIME_ALLOWLIST.has(file.type)) {
    return { ok: false, message: "Photo must be PNG, JPG, or WebP." };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, message: "Photo must be under 2 MB after cropping." };
  }

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
  const path = `${session.profile.id}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from("profile-avatars")
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
      cacheControl: "3600",
    });
  if (uploadErr) {
    return { ok: false, message: "Upload failed — try again." };
  }
  const { data: pub } = admin.storage.from("profile-avatars").getPublicUrl(path);
  if (!pub?.publicUrl) {
    await admin.storage.from("profile-avatars").remove([path]);
    return { ok: false, message: "Couldn't resolve the photo URL." };
  }

  // Best-effort cleanup of the previous avatar object. If the update
  // fails we don't want to leave the old file behind, but a leaked
  // orphan is not fatal — a cron sweep could clean up later.
  const priorUrl = session.profile.avatar_url;
  const { error } = await admin
    .from("profiles")
    .update({ avatar_url: pub.publicUrl })
    .eq("id", session.profile.id);
  if (error) {
    await admin.storage.from("profile-avatars").remove([path]);
    return { ok: false, message: "Couldn't save the photo." };
  }
  if (priorUrl) {
    const priorPath = extractAvatarPath(priorUrl);
    if (priorPath) {
      await admin.storage.from("profile-avatars").remove([priorPath]);
    }
  }

  revalidatePath("/profile");
  revalidatePath(`/people/${session.profile.id}`);
  revalidatePath("/", "layout"); // sidebar re-renders with new URL
  return { ok: true, url: pub.publicUrl };
}

export async function removeAvatarAction(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const session = await requireProfile();
  const priorUrl = session.profile.avatar_url;
  if (!priorUrl) return { ok: true };

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", session.profile.id);
  if (error) return { ok: false, message: "Couldn't remove that photo." };

  const priorPath = extractAvatarPath(priorUrl);
  if (priorPath) {
    await admin.storage.from("profile-avatars").remove([priorPath]);
  }
  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { ok: true };
}

// Recover the storage path (relative to the bucket) from a public URL.
// Public URLs look like https://<proj>.supabase.co/storage/v1/object/
// public/profile-avatars/<user_id>/<uuid>.png. We slice off up to and
// including the bucket segment.
function extractAvatarPath(publicUrl: string): string | null {
  const marker = "/profile-avatars/";
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}

export async function setProfileStatusAction(
  personId: string,
  status: "active" | "inactive"
): Promise<ProfileResult> {
  await requireRole(["system_admin", "company_admin", "aims_guide"]);

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
