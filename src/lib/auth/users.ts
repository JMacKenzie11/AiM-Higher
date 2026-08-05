"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { APP_URL } from "@/lib/supabase/env";
import { requireRole } from "@/lib/auth/current-user";
import type { Profile } from "@/lib/types";

// Roster actions — replaces the old invitations flow.
//
// A user has two phases:
//   1. "pending"  — admin has added them (auth.users + profiles rows
//      both exist) but no invite email has been sent yet. The person
//      can already be assigned to commitments, chart roles, etc.
//   2. "active"   — the person accepted the invite and set a password.
//
// Sending the invite is a separate action from creating the user, so
// admins can pre-stage a roster before anyone gets an email.

export type UserActionResult =
  | { ok: true; profileId?: string }
  | { ok: false; message: string };

// ---- Create a user (no email sent) ----------------------------
export async function createUserAction(
  _prev: UserActionResult | undefined,
  formData: FormData
): Promise<UserActionResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "team_member");
  const companyIdRaw = String(formData.get("company_id") ?? "");
  const sendInviteNow = formData.get("send_invite_now") === "on";

  const rawStrengths = formData.getAll("strength_label").map((v) => String(v).trim()).filter(Boolean);
  const rawSuperpowers = formData.getAll("superpower_label").map((v) => String(v).trim()).filter(Boolean);

  if (!email || !fullName) {
    return { ok: false, message: "Name and email are required." };
  }
  if (role !== "company_admin" && role !== "team_member") {
    return { ok: false, message: "Choose a valid role." };
  }

  const companyId =
    session.profile.role === "system_admin"
      ? companyIdRaw
      : session.profile.company_id!;

  if (!companyId) {
    return { ok: false, message: "Pick a company for this user." };
  }

  const admin = createSupabaseAdminClient();

  // Step 1: create the auth.users row (no email dispatched).
  // We leave email_confirm=false so a later inviteUserByEmail() will
  // send the standard Supabase invite email.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "";
    if (/already been registered|already exists/i.test(msg)) {
      return { ok: false, message: "A user with that email already exists." };
    }
    return { ok: false, message: "Couldn't create that user." };
  }

  const userId = created.user.id;

  // Step 2: profile row, status='pending'. Uses admin client so a
  // company_admin who lacks direct insert privilege on other companies'
  // profiles can still stage this row within their own company (the
  // company_id check is enforced above).
  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId,
    company_id: companyId,
    full_name: fullName,
    position,
    role,
    status: "pending",
  });

  if (profileErr) {
    // Best-effort cleanup — otherwise we'd leak an orphan auth user.
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, message: "Couldn't set up that user's profile." };
  }

  // Step 3: strengths + superpowers.
  const strengthsRows = [
    ...rawStrengths.map((label, i) => ({
      user_id: userId,
      kind: "strength" as const,
      label,
      sort_order: i,
    })),
    ...rawSuperpowers.map((label, i) => ({
      user_id: userId,
      kind: "superpower" as const,
      label,
      sort_order: i,
    })),
  ];
  if (strengthsRows.length > 0) {
    await admin.from("user_strengths").insert(strengthsRows);
  }

  // Step 4: optionally fire the invite immediately.
  if (sendInviteNow) {
    await dispatchInvite(userId, email);
  }

  revalidatePath(`/admin/companies/${companyId}`);
  revalidatePath(`/people`);
  return { ok: true, profileId: userId };
}

// ---- Update a user (admin-only) --------------------------------
// Full-profile edit. Handles first/last name, position, role,
// reports_to on public.profiles AND email on auth.users. Kept
// separate from updateProfileAction (which is the leaner
// self-serve edit on /profile) so email changes — which require
// the admin client — can't be triggered by a non-admin caller.
export async function updateUserAction(
  _prev: UserActionResult | undefined,
  formData: FormData
): Promise<UserActionResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const profileId = String(formData.get("id") ?? "");
  if (!profileId) return { ok: false, message: "Missing user id." };

  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const position = String(formData.get("position") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "");
  const reportsToRaw = String(formData.get("reports_to") ?? "").trim();
  const reportsTo = reportsToRaw && reportsToRaw !== profileId ? reportsToRaw : null;

  if (!firstName || !lastName) {
    return { ok: false, message: "First and last name are required." };
  }
  if (!email) {
    return { ok: false, message: "Email is required." };
  }
  if (
    role !== "system_admin" &&
    role !== "company_admin" &&
    role !== "team_member" &&
    role !== "aims_guide"
  ) {
    return { ok: false, message: "Choose a valid role." };
  }
  if (
    session.profile.role === "company_admin" &&
    (role === "system_admin" || role === "aims_guide")
  ) {
    return { ok: false, message: "Company admins can't grant that role." };
  }

  const admin = createSupabaseAdminClient();

  // Fetch the current row so we can scope-check + only touch email
  // when it actually changed (avoids re-sending Supabase's magic-link
  // confirmation for a no-op).
  const { data: current, error: fetchErr } = await admin
    .from("profiles")
    .select("id, company_id")
    .eq("id", profileId)
    .maybeSingle<Pick<Profile, "id" | "company_id">>();
  if (fetchErr || !current) return { ok: false, message: "User not found." };

  if (
    session.profile.role === "company_admin" &&
    session.profile.company_id !== current.company_id
  ) {
    return { ok: false, message: "Not your user to edit." };
  }

  // Grab the auth email so we know whether an update is needed.
  const { data: authUser } = await admin.auth.admin.getUserById(profileId);
  const currentEmail = authUser?.user?.email ?? null;
  const emailChanged = currentEmail !== email;

  if (emailChanged) {
    const { error: emailErr } = await admin.auth.admin.updateUserById(
      profileId,
      { email }
    );
    if (emailErr) {
      const msg = emailErr.message ?? "";
      if (/already been registered|already exists/i.test(msg)) {
        return { ok: false, message: "That email is already in use." };
      }
      return { ok: false, message: "Couldn't update the email address." };
    }
  }

  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      position,
      role,
      reports_to: reportsTo,
    })
    .eq("id", profileId);
  if (profileErr) {
    return { ok: false, message: "Couldn't save that user." };
  }

  if (current.company_id) revalidatePath(`/admin/companies/${current.company_id}`);
  revalidatePath("/people");
  revalidatePath(`/people/${profileId}`);
  return { ok: true, profileId };
}

// ---- Send / resend an invite email ---------------------------
export async function sendInviteAction(profileId: string): Promise<UserActionResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, company_id, status")
    .eq("id", profileId)
    .maybeSingle<Pick<Profile, "id" | "company_id" | "status">>();

  if (!profile) return { ok: false, message: "That user doesn't exist." };
  if (
    session.profile.role === "company_admin" &&
    session.profile.company_id !== profile.company_id
  ) {
    return { ok: false, message: "Not your user to invite." };
  }

  const admin = createSupabaseAdminClient();
  const { data: userRow, error: userErr } = await admin.auth.admin.getUserById(profileId);
  if (userErr || !userRow?.user?.email) {
    return { ok: false, message: "Couldn't find that user's email." };
  }

  const result = await dispatchInvite(profileId, userRow.user.email);
  if (!result.ok) return result;

  if (profile.company_id) revalidatePath(`/admin/companies/${profile.company_id}`);
  revalidatePath(`/people`);
  return { ok: true, profileId };
}

// Shared invite-email dispatcher — used on create-with-send and on
// standalone send/resend. If Supabase's email fails we still keep the
// user; the admin can retry.
async function dispatchInvite(profileId: string, email: string): Promise<UserActionResult> {
  const admin = createSupabaseAdminClient();
  const redirectTo = `${APP_URL()}/accept-invite`;
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (error) return { ok: false, message: "Couldn't send the invite email." };

  const { error: markErr } = await admin
    .from("profiles")
    .update({ invited_at: new Date().toISOString() })
    .eq("id", profileId);
  if (markErr) {
    // Non-fatal — email was sent, we just failed to record the timestamp.
  }
  return { ok: true, profileId };
}

// ---- Delete a user (cleans up auth + profile via cascade) ----
export async function deleteUserAction(profileId: string): Promise<UserActionResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  if (profileId === session.profile.id) {
    return { ok: false, message: "You can't delete your own account." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, company_id")
    .eq("id", profileId)
    .maybeSingle<Pick<Profile, "id" | "company_id">>();
  if (!profile) return { ok: false, message: "That user doesn't exist." };

  if (
    session.profile.role === "company_admin" &&
    session.profile.company_id !== profile.company_id
  ) {
    return { ok: false, message: "Not your user to delete." };
  }

  const admin = createSupabaseAdminClient();

  // Migration 0121 rewired every profile-referencing FK to either
  // cascade (personal rows: coaching threads/messages, strengths
  // assessment) or set null (work rows: commitments, scorecard +
  // measure entries, strengths teams, plan ownership, chart seats).
  // The delete just works now — no blocker probes needed.
  const { error } = await admin.auth.admin.deleteUser(profileId);
  if (error) {
    // Surface the DB message rather than a generic string so any
    // future schema drift (a new table with restrict FK) is
    // debuggable at a glance.
    return {
      ok: false,
      message: `Couldn't delete that user. ${error.message ?? ""}`.trim(),
    };
  }

  if (profile.company_id) revalidatePath(`/admin/companies/${profile.company_id}`);
  revalidatePath(`/people`);
  return { ok: true };
}

// ---- Accept invite: flip pending → active --------------------
// Called after the invitee sets their password. The Supabase invite
// email lands them here already signed in (auth session comes from
// the URL fragment tokens Supabase attaches). The profile row already
// exists — this just marks them active.
export async function acceptInviteAction(): Promise<UserActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Sign in first, then accept the invitation." };
  }

  const admin = createSupabaseAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, status")
    .eq("id", user.id)
    .maybeSingle<Pick<Profile, "id" | "status">>();

  if (error || !profile) {
    return { ok: false, message: "We couldn't find your account. Ask your admin to add you." };
  }

  // Idempotent — accept-invite may be reloaded after status flips.
  if (profile.status !== "active") {
    const { error: updateErr } = await admin
      .from("profiles")
      .update({ status: "active" })
      .eq("id", user.id);
    if (updateErr) {
      return { ok: false, message: "Couldn't finish setting up your account." };
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
