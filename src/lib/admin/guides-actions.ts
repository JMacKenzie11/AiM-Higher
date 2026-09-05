"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatchInvite } from "@/lib/auth/users";
import { reportError } from "@/lib/observability/report";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Server actions for AiMS Guide management. System-admin only.
//
// Semantics:
//   - Guides have no primary company_id. Their access derives from
//     rows in guide_assignments.
//   - Invite requires at least one initial assignment — a guide with
//     no companies has nothing to see on sign-in.
//   - Assign / unassign is idempotent: re-assigning an existing pair
//     is a no-op; unassigning a pair that isn't there is a no-op.

export type GuideActionResult =
  | { ok: true; guideId?: string; warning?: string }
  | { ok: false; message: string };

async function guard(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  await requireRole(["system_admin"]);
  return { ok: true };
}

// ---- Create a guide ------------------------------------------
// Creates an auth user + profile row with role='aims_guide' and one
// or more guide_assignments, then fires an invite email through the
// same dispatchInvite pipeline every other new user uses (hashed
// token → /auth/callback → verifyOtp → password).
//
// Previously this action created the auth user with
// email_confirm=true and status='active' but never sent any invite
// (the comment claimed "sends a magic link" but no code did that).
// Result: guides existed in the DB with no password, no invite
// link, no way to sign in — hence Jeff Boumwan's dead-end state
// on 2026-08-08.
export async function createGuideAction(
  formData: FormData
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim() || null;
  const companyIds = formData
    .getAll("company_id")
    .map((v) => String(v).trim())
    .filter(Boolean);

  if (!email) return { ok: false, message: "Email is required." };
  if (!fullName) return { ok: false, message: "Full name is required." };
  if (companyIds.length === 0) {
    return {
      ok: false,
      message:
        "Pick at least one company to assign the guide to before creating them.",
    };
  }

  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());

  // Step 1: auth user. email_confirm=false — verifyOtp will confirm
  // the email when the guide clicks the invite link.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
  });
  if (createErr || !created?.user) {
    reportError("guides.create.authUser", createErr ?? new Error("no user returned"), { email });
    return {
      ok: false,
      message: createErr?.message ?? "Couldn't create the auth user.",
    };
  }
  const guideId = created.user.id;

  // Step 2: profile row with role='aims_guide' and no company_id.
  // status='pending' so the middleware guard bounces them back to
  // /accept-invite if they abandon the password step, same as any
  // other newly-invited user.
  const { error: profileErr } = await admin.from("profiles").insert({
    id: guideId,
    company_id: null,
    full_name: fullName,
    position,
    role: "aims_guide",
    status: "pending",
  });
  if (profileErr) {
    reportError("guides.create.profile", profileErr, { guideId, email });
    await admin.auth.admin.deleteUser(guideId);
    return {
      ok: false,
      message: `Couldn't set up the guide profile: ${profileErr.message}`,
    };
  }

  // Step 3: assignments.
  const rows = companyIds.map((cid) => ({
    guide_id: guideId,
    company_id: cid,
  }));
  const { error: assignErr } = await admin
    .from("guide_assignments")
    .insert(rows);
  if (assignErr) {
    reportError("guides.create.assignments", assignErr, { guideId, companyIds });
    // Roll back: delete the guide entirely so we don't leak an
    // orphan profile with no assignments.
    await admin.auth.admin.deleteUser(guideId);
    return {
      ok: false,
      message: `Couldn't assign companies: ${assignErr.message}`,
    };
  }

  // Step 4: fire the invite. Surfaces as a warning on the create
  // result if the send fails — the guide is IN the system either
  // way, an admin can hit "Resend invite" from GuideRowActions.
  let warning: string | undefined;
  const dispatch = await dispatchInvite(guideId, email);
  if (!dispatch.ok) {
    reportError("guides.create.invite", new Error(dispatch.message), { guideId, email });
    warning = `Guide added, but the invite email didn't send: ${dispatch.message}`;
  }

  revalidatePath("/admin/companies", "layout");
  return { ok: true, guideId, warning };
}

// ---- Resend a guide's invite --------------------------------
// For guides who never received their initial invite (Jeff), for
// guides whose invite link has expired past the 24h Supabase cap,
// or any time an admin wants to hand them a fresh link. Uses the
// same dispatchInvite pipeline as regular user resends.
export async function resendGuideInviteAction(
  guideId: string
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, status")
    .eq("id", guideId)
    .maybeSingle<{ id: string; role: string; status: string }>();
  if (!profile || profile.role !== "aims_guide") {
    return { ok: false, message: "That user isn't an AiMS Guide." };
  }
  // Same guard as sendInviteAction for regular users: an active
  // guide has already accepted, a deactivated one shouldn't be
  // re-invited. GuideRowActions currently always shows "Resend
  // invite" regardless of status; this catches the misclick.
  if (profile.status === "active") {
    return {
      ok: false,
      message: "That guide is already active — they don't need an invite.",
    };
  }
  if (profile.status === "inactive") {
    return {
      ok: false,
      message: "That guide is deactivated. Reactivate them first.",
    };
  }
  const { data: userRow, error: userErr } =
    await admin.auth.admin.getUserById(guideId);
  if (userErr || !userRow?.user?.email) {
    reportError("guides.resend.getUser", userErr ?? new Error("no email"), { guideId });
    return { ok: false, message: "Couldn't find that guide's email." };
  }

  const dispatch = await dispatchInvite(guideId, userRow.user.email);
  if (!dispatch.ok) {
    reportError("guides.resend.invite", new Error(dispatch.message), { guideId });
    return { ok: false, message: dispatch.message };
  }

  revalidatePath("/admin/companies", "layout");
  return { ok: true, guideId };
}

// ---- Assign a guide to a company -----------------------------
// Accepts either an aims_guide profile (assignment IS their access
// grant) or a system_admin profile (assignment is a caseload marker
// only; their access is already unrestricted). Anything else is
// rejected as a defensive check against stale form state.
export async function assignGuideAction(
  guideId: string,
  companyId: string
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!guideId || !companyId) {
    return { ok: false, message: "Pick a guide and a company." };
  }

  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", guideId)
    .maybeSingle<{ id: string; role: string }>();
  if (
    !profile ||
    (profile.role !== "aims_guide" && profile.role !== "system_admin")
  ) {
    return {
      ok: false,
      message: "That user isn't an AiMS Guide or system admin.",
    };
  }

  const { error } = await admin
    .from("guide_assignments")
    .upsert(
      { guide_id: guideId, company_id: companyId },
      { onConflict: "guide_id,company_id" }
    );
  if (error) {
    reportError("guides.assign.upsert", error, { guideId, companyId });
    return { ok: false, message: error.message };
  }

  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

// ---- Assign a system admin as a working guide (bulk) --------
// Called from the "Give a system admin a coaching caseload" mini-form
// on the Guides panel. Same semantics as assignGuideAction, but takes
// N companies at once so the sysadmin can seed a caseload without
// N separate clicks. Idempotent per pair (upsert on conflict).
export async function assignExistingAsGuideAction(
  formData: FormData
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const guideId = String(formData.get("guide_id") ?? "").trim();
  const companyIds = formData
    .getAll("company_id")
    .map((v) => String(v).trim())
    .filter(Boolean);

  if (!guideId) return { ok: false, message: "Pick a person." };
  if (companyIds.length === 0) {
    return { ok: false, message: "Pick at least one company." };
  }

  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", guideId)
    .maybeSingle<{ id: string; role: string }>();
  if (
    !profile ||
    (profile.role !== "aims_guide" && profile.role !== "system_admin")
  ) {
    return {
      ok: false,
      message: "That user isn't an AiMS Guide or system admin.",
    };
  }

  const rows = companyIds.map((cid) => ({
    guide_id: guideId,
    company_id: cid,
  }));
  const { error } = await admin
    .from("guide_assignments")
    .upsert(rows, { onConflict: "guide_id,company_id" });
  if (error) {
    reportError("guides.assignExisting.upsert", error, { guideId, companyIds });
    return { ok: false, message: error.message };
  }

  revalidatePath("/admin/companies", "layout");
  return { ok: true, guideId };
}

// ---- Unassign a guide from a company -------------------------
// For aims_guide profiles, the "not the last company" invariant
// still holds — a zero-assignment guide has no access to anything.
// For system_admin profiles, the last assignment is safe to remove
// because their cross-tenant access is role-based, not
// assignment-based; unassigning is a caseload cleanup, not an
// access change.
export async function unassignGuideAction(
  guideId: string,
  companyId: string
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", guideId)
    .maybeSingle<{ role: string }>();

  if (profile?.role === "aims_guide") {
    const { count } = await admin
      .from("guide_assignments")
      .select("*", { count: "exact", head: true })
      .eq("guide_id", guideId);
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        message:
          "This is the guide's only company. Delete the guide instead if they're no longer coaching.",
      };
    }
  }

  const { error } = await admin
    .from("guide_assignments")
    .delete()
    .eq("guide_id", guideId)
    .eq("company_id", companyId);
  if (error) {
    reportError("guides.unassign.delete", error, { guideId, companyId });
    return { ok: false, message: error.message };
  }

  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

// ---- Delete a guide entirely --------------------------------
export async function deleteGuideAction(
  guideId: string
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin.auth.admin.deleteUser(guideId);
  if (error) {
    reportError("guides.delete.authUser", error, { guideId });
    return { ok: false, message: error.message };
  }
  // profile + guide_assignments cascade away with the auth row.

  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}
