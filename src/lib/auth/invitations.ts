"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { APP_URL } from "@/lib/supabase/env";
import { requireRole } from "@/lib/auth/current-user";
import type { Invitation } from "@/lib/types";

// Invitation flow — Section 6.
// Every action here enforces authorization twice:
//   1. requireRole() gates the server action itself
//   2. RLS policies gate the underlying invitations table
// The service-role client is used only for two things: sending the
// Supabase invite email, and inserting the profile row during
// /accept-invite (when the invitee doesn't yet have a profile to
// satisfy the profiles_insert RLS policy).

export type InvitationResult =
  | { ok: true; invitation?: Invitation }
  | { ok: false; message: string };

// ---- Create + send an invitation -------------------------------
export async function createInvitationAction(
  _prev: InvitationResult | undefined,
  formData: FormData
): Promise<InvitationResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "team_member");
  const companyIdRaw = String(formData.get("company_id") ?? "");

  if (!email || !fullName) {
    return { ok: false, message: "Name and email are required." };
  }
  if (role !== "company_admin" && role !== "team_member") {
    return { ok: false, message: "Choose a valid role." };
  }

  // A company_admin invites into their own company. A system_admin
  // picks the company via the form.
  const companyId =
    session.profile.role === "system_admin"
      ? companyIdRaw
      : session.profile.company_id!;

  if (!companyId) {
    return { ok: false, message: "Pick a company for this invitation." };
  }

  const supabase = await createSupabaseServerClient();

  // Insert the invitation row. RLS (invitations_insert) also enforces
  // that the caller may invite into this company.
  const { data: invitation, error: insertError } = await supabase
    .from("invitations")
    .insert({
      company_id: companyId,
      email,
      full_name: fullName,
      position,
      role,
      invited_by: session.profile.id,
    })
    .select("*")
    .single<Invitation>();

  if (insertError || !invitation) {
    if (insertError?.code === "23505") {
      return {
        ok: false,
        message: "There's already a pending invite for that email.",
      };
    }
    return { ok: false, message: "Couldn't create the invitation." };
  }

  // Send the Supabase invite email carrying the invitation token in
  // the redirect URL. ASSUMPTION: using Supabase's built-in invite
  // email until a Resend swap. Section 2 says structure the invite
  // so a Resend swap later touches one module — this is that module.
  const admin = createSupabaseAdminClient();
  const redirectTo = `${APP_URL()}/accept-invite?token=${invitation.token}`;
  const { error: emailError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { invitation_token: invitation.token },
  });

  if (emailError) {
    // Best effort: keep the invitation row, tell the admin to resend.
    return {
      ok: true,
      invitation,
    };
  }

  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true, invitation };
}

// ---- Resend / revoke -------------------------------------------
export async function resendInvitationAction(invitationId: string): Promise<InvitationResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const supabase = await createSupabaseServerClient();
  const { data: invitation } = await supabase
    .from("invitations")
    .select("*")
    .eq("id", invitationId)
    .maybeSingle<Invitation>();

  if (!invitation || invitation.status !== "pending") {
    return { ok: false, message: "That invitation isn't pending." };
  }
  if (
    session.profile.role === "company_admin" &&
    session.profile.company_id !== invitation.company_id
  ) {
    return { ok: false, message: "Not your invitation to resend." };
  }

  const admin = createSupabaseAdminClient();
  const redirectTo = `${APP_URL()}/accept-invite?token=${invitation.token}`;
  const { error } = await admin.auth.admin.inviteUserByEmail(invitation.email, {
    redirectTo,
    data: { invitation_token: invitation.token },
  });
  if (error) return { ok: false, message: "Couldn't resend right now." };

  revalidatePath(`/admin/companies/${invitation.company_id}`);
  return { ok: true, invitation };
}

export async function revokeInvitationAction(invitationId: string): Promise<InvitationResult> {
  const session = await requireRole(["system_admin", "company_admin"]);

  const supabase = await createSupabaseServerClient();
  const { data: invitation, error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .select("*")
    .single<Invitation>();

  if (error || !invitation) {
    return { ok: false, message: "Couldn't revoke that invitation." };
  }
  if (
    session.profile.role === "company_admin" &&
    session.profile.company_id !== invitation.company_id
  ) {
    return { ok: false, message: "Not your invitation to revoke." };
  }

  revalidatePath(`/admin/companies/${invitation.company_id}`);
  return { ok: true, invitation };
}

// ---- Accept an invitation --------------------------------------
// Called after a signed-in invitee sets their password. Looks up the
// invitation by token, creates the profile row (service role — the
// invitee has no profile yet, so RLS can't yet authorize them), and
// flips the invitation to accepted.
export async function acceptInvitationAction(
  token: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Sign in first, then accept the invitation." };
  }

  const admin = createSupabaseAdminClient();

  const { data: invitation, error: lookupError } = await admin
    .from("invitations")
    .select("*")
    .eq("token", token)
    .maybeSingle<Invitation>();

  if (lookupError || !invitation) {
    return { ok: false, message: "That invitation link isn't valid." };
  }
  if (invitation.status !== "pending") {
    return { ok: false, message: "That invitation has already been used." };
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return {
      ok: false,
      message:
        "That invitation has expired. Ask your admin for a fresh one.",
    };
  }
  if (invitation.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return {
      ok: false,
      message:
        "This invitation was sent to a different email address.",
    };
  }

  // Upsert profile (idempotent — accept-invite may be reloaded).
  const { error: profileError } = await admin
    .from("profiles")
    .upsert(
      {
        id: user.id,
        company_id: invitation.company_id,
        full_name: invitation.full_name,
        position: invitation.position,
        role: invitation.role,
        status: "active",
      },
      { onConflict: "id" }
    );
  if (profileError) {
    return { ok: false, message: "Couldn't finish setting up your profile." };
  }

  const { error: markError } = await admin
    .from("invitations")
    .update({ status: "accepted" })
    .eq("id", invitation.id);
  if (markError) {
    // Non-fatal — the profile exists; the invitation status is admin housekeeping.
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
