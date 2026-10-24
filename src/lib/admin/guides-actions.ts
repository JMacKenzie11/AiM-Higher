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
//   - A guide's access derives from rows in guide_assignments. Their
//     company_id is null, unless a system admin gave them a company of
//     their own (setGuideOwnCompanyAction): a coach who runs a
//     coaching business and guides clients from the same login.
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

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());

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

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
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

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
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

export async function deleteGuideAction(
  guideId: string
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin.auth.admin.deleteUser(guideId);
  if (error) {
    reportError("guides.delete.authUser", error, { guideId });
    return { ok: false, message: error.message };
  }
  // profile + guide_assignments cascade away with the auth row.

  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

// ---- Set a guide's whole caseload in one go ------------------
//
// The checkbox card's action, replacing the chip-per-company × and
// the separate "Assign To" picker with one Update. Same shape as
// setPortfolioCompanyAccessAction, and for the same reason: a guide
// and a portfolio admin are the same question asked twice — a person
// with no company_id of their own holding rights in a list of
// companies.
//
// RELEASING THE WORK IS PART OF REMOVING, not a nicety. A guide's
// auth_company_id() is null, so commitments_update_owner — which
// requires `auth_company_id() = company_id` — has never admitted
// them. Their only write path into a company is is_guide_for(). Take
// the assignment away and any commitment they still own there becomes
// unresolvable by them, renders as "Unassigned" because the roster
// lookup no longer finds them, and cannot be claimed because
// owner_id is not actually null. Guides can own commitments as of
// decision 10, so this stopped being hypothetical.
//
// THE ORDER MATTERS: release while the assignment still stands, or
// the release is refused and the work is stranded by the act meant to
// free it.
export async function setGuideCompanyAccessAction(
  guideId: string,
  companyIds: string[]
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());

  const [{ data: profile }, { data: currentRows }] = await Promise.all([
    admin
      .from("profiles")
      .select("role, company_id")
      .eq("id", guideId)
      .maybeSingle<{ role: string; company_id: string | null }>(),
    admin
      .from("guide_assignments")
      .select("company_id")
      .eq("guide_id", guideId),
  ]);

  const current = new Set(
    ((currentRows ?? []) as Array<{ company_id: string }>).map(
      (r) => r.company_id
    )
  );
  const wanted = new Set(companyIds);
  const toAdd = [...wanted].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !wanted.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) {
    return { ok: true };
  }

  // A GUIDE KEEPS AT LEAST ONE COMPANY. Carried over from
  // unassignGuideAction, which refused to remove the last one: a
  // guide coaching nobody is a guide who should be deleted, and the
  // message says so rather than leaving an empty caseload behind. A
  // system admin carrying a caseload may go to zero — the role does
  // not depend on it.
  if (profile?.role === "aims_guide" && wanted.size === 0) {
    return {
      ok: false,
      message:
        "A guide needs at least one company. Delete the guide instead if they're no longer coaching.",
    };
  }

  // THEIR OWN COMPANY STAYS TICKED. The assignment is what makes the
  // guide its admin, and a guide who belongs to a company they cannot
  // administer is not what anyone set up. Change or clear their own
  // company first.
  if (profile?.company_id && toRemove.includes(profile.company_id)) {
    return {
      ok: false,
      message:
        "That's the guide's own company. Change their own company first.",
    };
  }

  if (toAdd.length > 0) {
    const { error } = await admin.from("guide_assignments").insert(
      toAdd.map((company_id) => ({ guide_id: guideId, company_id }))
    );
    if (error) {
      reportError("guides.setAccess.insert", error, { guideId });
      return { ok: false, message: error.message };
    }
  }

  for (const companyId of toRemove) {
    const { error } = await admin
      .from("commitments")
      .update({ owner_id: null })
      .eq("company_id", companyId)
      .eq("owner_id", guideId)
      .eq("status", "open")
      .is("deleted_at", null);
    if (error) {
      reportError("guides.setAccess.release", error, { guideId, companyId });
      return {
        ok: false,
        message:
          "Couldn't release their open commitments, so nothing was removed.",
      };
    }
  }

  if (toRemove.length > 0) {
    const { error } = await admin
      .from("guide_assignments")
      .delete()
      .eq("guide_id", guideId)
      .in("company_id", toRemove);
    if (error) {
      reportError("guides.setAccess.delete", error, { guideId });
      return { ok: false, message: error.message };
    }
  }

  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

// ---- Give a guide a company of their own ---------------------
//
// For a coach who runs their own coaching business and guides their
// clients from the same login (Jason, 2026-10-24). System admin only.
//
// Two writes, and both are needed:
//   - profiles.company_id makes them a MEMBER: on its chart, owning
//     its commitments, priorities and critical success factors, at
//     its meetings. Their role stays aims_guide, which keeps their
//     clients.
//   - a guide_assignments row makes them its ADMIN, through the same
//     rules that make a guide the admin of a client. No policy needed
//     changing for that.
//
// Moving them to another company leaves the old one as a client
// assignment, untickable in the access card like any other. Clearing
// it (companyId null) makes them a guide with no company of their own
// again, and leaves the assignment for the same reason.
//
// 0300 keeps the company's own admins and its other guides from
// changing or deleting the guide's account once they belong to it.
//
// A system admin carrying a caseload can have one too (Jason,
// 2026-10-24): the same two writes, and their role stays
// system_admin. scope.ts does not pin either role to it, and the
// harness probe "a system admin's own company" shows a company_id
// narrows nothing either role reads.
export async function setGuideOwnCompanyAction(
  guideId: string,
  companyId: string | null
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, company_id")
    .eq("id", guideId)
    .maybeSingle<{ id: string; role: string; company_id: string | null }>();
  if (!profile || (profile.role !== "aims_guide" && profile.role !== "system_admin")) {
    return { ok: false, message: "That user isn't an AiMS Guide." };
  }
  if ((profile.company_id ?? null) === companyId) return { ok: true, guideId };

  if (companyId) {
    const { data: company } = await admin
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .is("deleted_at", null)
      .maybeSingle<{ id: string }>();
    if (!company) return { ok: false, message: "That company is no longer available." };

    // The assignment first: a guide who belongs to a company and is
    // not yet its admin is the state to never leave behind.
    const { error: assignErr } = await admin
      .from("guide_assignments")
      .upsert({ guide_id: guideId, company_id: companyId }, { onConflict: "guide_id,company_id" });
    if (assignErr) {
      reportError("guides.ownCompany.assign", assignErr, { guideId, companyId });
      return { ok: false, message: "Couldn't make them that company's admin, so nothing changed." };
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({ company_id: companyId })
    .eq("id", guideId);
  if (error) {
    reportError("guides.ownCompany.profile", error, { guideId, companyId });
    return { ok: false, message: "Couldn't save their own company." };
  }

  revalidatePath("/admin/companies", "layout");
  revalidatePath("/people");
  revalidatePath("/chart");
  return { ok: true, guideId };
}

// ---- One Save on a guide's row ---------------------------------
//
// Jason, 2026-10-24: the row's own company and its companies are saved
// together, by one button. Their own company goes first: it adds its
// assignment, and moving off an old one is what lets the old one be
// unticked in the same save. Their own company is always kept in the
// list, as setGuideCompanyAccessAction requires.
export async function saveGuideAction(
  guideId: string,
  companyIds: string[],
  // Left out, their own company is left as it is.
  ownCompanyId?: string | null
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (ownCompanyId !== undefined) {
    const own = await setGuideOwnCompanyAction(guideId, ownCompanyId);
    if (!own.ok) return own;
  }
  const ids = ownCompanyId && !companyIds.includes(ownCompanyId) ? [...companyIds, ownCompanyId] : companyIds;
  return setGuideCompanyAccessAction(guideId, ids);
}
