"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { APP_URL } from "@/lib/supabase/env";
import { requireRole } from "@/lib/auth/current-user";
import { sendInviteEmail } from "@/lib/email";
import { track } from "@/lib/analytics/track";
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
  | { ok: true; profileId?: string; warning?: string }
  | { ok: false; message: string };

// ---- Create a user (no email sent) ----------------------------
export async function createUserAction(
  _prev: UserActionResult | undefined,
  formData: FormData
): Promise<UserActionResult> {
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "team_member");
  const companyIdRaw = String(formData.get("company_id") ?? "");
  const sendInviteNow = formData.get("send_invite_now") === "on";

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

  // Step 3: optionally fire the invite immediately. We surface any
  // send failure as a warning on the (still-successful) create result
  // — the user IS in the system; they just need a manual resend.
  // Previously we awaited dispatchInvite and threw the result away,
  // which is how invites like jasonm@thedadedge.com's silently
  // vanished on 2026-08-06.
  let warning: string | undefined;
  if (sendInviteNow) {
    const dispatch = await dispatchInvite(userId, email, session.profile.id);
    if (!dispatch.ok) {
      warning = `User added, but the invite email didn't send: ${dispatch.message}`;
    }
  }

  revalidatePath(`/admin/companies/${companyId}`);
  revalidatePath(`/people`);
  return { ok: true, profileId: userId, warning };
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
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);

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

// ---- Self-serve fresh invite from the expired-link screen ----
// Called from AcceptInviteForm when the invite link has expired
// and the invitee wants a new one without pinging their admin.
// Public endpoint (unauthenticated) — hardened accordingly:
//   - Always returns { ok: true } so an attacker probing emails
//     can't distinguish "unknown", "already-active", or "sent"
//     from each other.
//   - Only fires the actual dispatch when the profile exists AND
//     is still `pending` — active users never trigger a magic
//     sign-in link through this path (would let anyone spam an
//     inbox with sign-in prompts).
//   - 60-second per-account cooldown using profiles.invited_at
//     as the throttle clock; the same email hammering this route
//     silently no-ops after the first success.
export async function requestFreshInviteAction(
  email: string
): Promise<{ ok: true }> {
  const normalized = String(email ?? "").trim().toLowerCase();
  // Every branch below returns ok:true to preserve the
  // don't-leak-existence contract.
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: true };
  }

  const admin = createSupabaseAdminClient();

  // Paginated listUsers is the only email→user lookup the auth
  // admin API surfaces. Fine at our scale (< a few thousand users);
  // swap for an RPC if this ever gets hot.
  let authUserId: string | null = null;
  for (let page = 1; page <= 10 && !authUserId; page++) {
    const { data } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    const match = data?.users?.find((u) => u.email === normalized);
    if (match) authUserId = match.id;
    if (!data?.users || data.users.length < 200) break;
  }
  if (!authUserId) return { ok: true };

  const { data: profile } = await admin
    .from("profiles")
    .select("id, status, invited_at")
    .eq("id", authUserId)
    .maybeSingle<Pick<Profile, "id" | "status" | "invited_at">>();
  if (!profile || profile.status !== "pending") return { ok: true };

  // Cooldown: silently succeed if we already sent one in the last
  // minute. Cheap throttle without a table; dispatchInvite's
  // markInvited() bumps invited_at so the next request within 60s
  // hits this early return.
  if (profile.invited_at) {
    const ageMs = Date.now() - new Date(profile.invited_at).getTime();
    if (ageMs < 60_000) return { ok: true };
  }

  const result = await dispatchInvite(profile.id, normalized);
  if (!result.ok) {
    console.warn("requestFreshInviteAction dispatch failed:", {
      email: normalized,
      message: result.message,
    });
  }
  return { ok: true };
}

// ---- Send / resend an invite email ---------------------------
export async function sendInviteAction(profileId: string): Promise<UserActionResult> {
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);

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
  // Invites only make sense while the user hasn't accepted yet.
  // Sending one to an active user emails them an "you've been invited"
  // link they don't need; sending one to an inactive user is worse
  // (they were intentionally deactivated). UI already hides the
  // action for these cases; this is the belt-and-braces guard for a
  // direct action call.
  if (profile.status === "active") {
    return {
      ok: false,
      message: "That user is already active — they don't need an invite.",
    };
  }
  if (profile.status === "inactive") {
    return {
      ok: false,
      message: "That user is deactivated. Reactivate them first.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { data: userRow, error: userErr } = await admin.auth.admin.getUserById(profileId);
  if (userErr || !userRow?.user?.email) {
    return { ok: false, message: "Couldn't find that user's email." };
  }

  const result = await dispatchInvite(profileId, userRow.user.email, session.profile.id);
  if (!result.ok) return result;

  if (profile.company_id) revalidatePath(`/admin/companies/${profile.company_id}`);
  revalidatePath(`/people`);
  return { ok: true, profileId };
}

// ---- Copy invite link (no email) -----------------------------
// Returns a fresh magic-link URL the admin can share via any channel
// they choose (Slack DM, SMS, in person). Same token semantics as
// the email path: 24h expiry (Supabase's Email OTP Expiration),
// one-shot use, verified through /auth/callback → verifyOtp.
// Bumps invited_at so the roster status pill reflects that a link
// is out — identical to the email path from the pipeline's POV.
export type InviteLinkResult =
  | { ok: true; link: string }
  | { ok: false; message: string };

export async function getInviteLinkAction(
  profileId: string
): Promise<InviteLinkResult> {
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);

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
  // Same guard as sendInviteAction: no invite link for an active or
  // deactivated user. See the comment there for rationale.
  if (profile.status === "active") {
    return {
      ok: false,
      message: "That user is already active — no invite link needed.",
    };
  }
  if (profile.status === "inactive") {
    return {
      ok: false,
      message: "That user is deactivated. Reactivate them first.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { data: userRow, error: userErr } =
    await admin.auth.admin.getUserById(profileId);
  if (userErr || !userRow?.user?.email) {
    return { ok: false, message: "Couldn't find that user's email." };
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userRow.user.email,
    options: { redirectTo: `${APP_URL()}/accept-invite` },
  });
  if (error) {
    console.warn("generateLink(magiclink) failed for getInviteLink:", {
      profileId,
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      message: error.message,
    });
    return {
      ok: false,
      message: `Couldn't generate a sign-in link: ${error.message}`,
    };
  }
  const hashedToken = (
    data as { properties?: { hashed_token?: string } }
  )?.properties?.hashed_token;
  if (!hashedToken) {
    return {
      ok: false,
      message: "Couldn't generate a sign-in link for this user.",
    };
  }
  const link =
    `${APP_URL()}/accept-invite` +
    `?token_hash=${encodeURIComponent(hashedToken)}` +
    `&type=magiclink`;

  await markInvited(admin, profileId);

  if (profile.company_id) revalidatePath(`/admin/companies/${profile.company_id}`);
  revalidatePath(`/people`);
  return { ok: true, link };
}

// Shared invite-email dispatcher — used on create-with-send and on
// standalone send/resend.
//
// We always pre-create the auth.users row in createUserAction, so
// admin.inviteUserByEmail() is a dead code path here — it insists on
// creating a fresh auth user and always fails with email_exists.
// We used to try it first and fall back on that specific error, but
// that fallback got skipped whenever Supabase returned a different
// error shape (rate limit, transient network, new error code), the
// failure was swallowed, and the invite silently vanished.
//
// Straight to generateLink({ magiclink }) + our own Resend send:
// one Supabase call instead of two, no error-code guessing, every
// send shows up in the Resend dashboard.
export async function dispatchInvite(
  profileId: string,
  email: string,
  senderProfileId?: string
): Promise<UserActionResult> {
  const admin = createSupabaseAdminClient();
  // Ask Supabase to generate a magic-link OTP for this user. We
  // deliberately don't use the returned action_link (which routes
  // through Supabase's /auth/v1/verify endpoint and, on PKCE-flow
  // projects, redirects with ?code= — which our server-side
  // exchangeCodeForSession can't complete without a client-side
  // code_verifier that admin-issued flows never set). Instead we
  // pluck the hashed_token off the response and build our own link
  // that hits /auth/callback with ?token_hash=&type= directly, so
  // verifyOtp handles the exchange server-side. That's the pattern
  // @supabase/ssr is designed around for admin-initiated flows.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      // Still required by Supabase, even though we don't send the
      // action_link to the user. Point it at the final destination
      // so if anyone does end up on it, they land in the right place.
      redirectTo: `${APP_URL()}/accept-invite`,
    },
  });

  if (error) {
    console.warn("generateLink(magiclink) failed:", {
      profileId,
      email,
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      message: error.message,
    });
    return {
      ok: false,
      message: `Couldn't generate a sign-in link: ${error.message}`,
    };
  }

  const hashedToken = (
    data as { properties?: { hashed_token?: string } }
  )?.properties?.hashed_token;
  if (!hashedToken) {
    console.warn("generateLink returned no hashed_token", { profileId, email });
    return {
      ok: false,
      message: "Couldn't generate a sign-in link for this user.",
    };
  }

  // Link points DIRECTLY at /accept-invite with the token in the
  // query — no /auth/callback hop. verifyOtp only fires when the
  // user submits the password form, so link previewers / scanners
  // (Microsoft SafeLinks, iMessage LinkPresentation, Slack unfurl)
  // that GET the URL never consume the one-shot token. Matches the
  // GitHub / Google / modern SaaS pattern: token-as-form-submit.
  const link =
    `${APP_URL()}/accept-invite` +
    `?token_hash=${encodeURIComponent(hashedToken)}` +
    `&type=magiclink`;

  const { data: profile } = await admin
    .from("profiles")
    .select("first_name")
    .eq("id", profileId)
    .maybeSingle<Pick<Profile, "first_name">>();

  const sent = await sendInviteEmail({
    to: email,
    firstName: profile?.first_name ?? null,
    actionLink: link,
  });

  if (!sent.ok) {
    // Log the link so admins can hand it to the user manually if
    // Resend is down or unconfigured (e.g. local dev without a key).
    console.info("invite email failed; magic link for", email, "→", link);
    return {
      ok: false,
      message: `Generated a sign-in link but couldn't email it: ${sent.message}`,
    };
  }

  await markInvited(admin, profileId);
  if (senderProfileId) {
    after(() =>
      track(senderProfileId, "invite.sent", {
        invitee_profile_id: profileId,
      })
    );
  }
  return { ok: true, profileId };
}

async function markInvited(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  profileId: string
): Promise<void> {
  const { error: markErr } = await admin
    .from("profiles")
    .update({ invited_at: new Date().toISOString() })
    .eq("id", profileId);
  if (markErr) {
    // Non-fatal — email/link went out, we just failed to record the timestamp.
    console.warn("failed to update invited_at:", {
      profileId,
      message: markErr.message,
    });
  }
}

// ---- Delete a user (cleans up auth + profile via cascade) ----
export async function deleteUserAction(profileId: string): Promise<UserActionResult> {
  const session = await requireRole(["system_admin", "company_admin", "aims_guide"]);

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
