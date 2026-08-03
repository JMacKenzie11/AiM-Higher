"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
  | { ok: true; guideId?: string }
  | { ok: false; message: string };

async function guard(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  await requireRole(["system_admin"]);
  return { ok: true };
}

// ---- Create a guide ------------------------------------------
// Creates an auth user + profile row with role='aims_guide' and one
// or more guide_assignments. Password is left unset — the guide gets
// a magic-link invite through the standard Supabase auth flow.
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

  const admin = createSupabaseAdminClient();

  // Step 1: auth user (email-confirmed = false; sends a magic link
  // via Supabase's own invite flow when confirmed).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    return {
      ok: false,
      message: createErr?.message ?? "Couldn't create the auth user.",
    };
  }
  const guideId = created.user.id;

  // Step 2: profile row with role='aims_guide' and no company_id.
  const { error: profileErr } = await admin.from("profiles").insert({
    id: guideId,
    company_id: null,
    full_name: fullName,
    position,
    role: "aims_guide",
    status: "active",
  });
  if (profileErr) {
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
    // Roll back: delete the guide entirely so we don't leak an
    // orphan profile with no assignments.
    await admin.auth.admin.deleteUser(guideId);
    return {
      ok: false,
      message: `Couldn't assign companies: ${assignErr.message}`,
    };
  }

  revalidatePath("/admin/companies", "layout");
  return { ok: true, guideId };
}

// ---- Assign a guide to a company -----------------------------
export async function assignGuideAction(
  guideId: string,
  companyId: string
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!guideId || !companyId) {
    return { ok: false, message: "Pick a guide and a company." };
  }

  const admin = createSupabaseAdminClient();
  // Confirm the target profile is actually a guide — belt-and-braces
  // so a stale form field can't quietly promote a company_admin.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", guideId)
    .maybeSingle<{ id: string; role: string }>();
  if (!profile || profile.role !== "aims_guide") {
    return { ok: false, message: "That user isn't an AiMS Guide." };
  }

  const { error } = await admin
    .from("guide_assignments")
    .upsert(
      { guide_id: guideId, company_id: companyId },
      { onConflict: "guide_id,company_id" }
    );
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

// ---- Unassign a guide from a company -------------------------
// Never leaves a guide with zero assignments — the /people invite
// flow would let a zero-assignment guide be created, but this action
// keeps the invariant intact for existing guides.
export async function unassignGuideAction(
  guideId: string,
  companyId: string
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = createSupabaseAdminClient();
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

  const { error } = await admin
    .from("guide_assignments")
    .delete()
    .eq("guide_id", guideId)
    .eq("company_id", companyId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

// ---- Delete a guide entirely --------------------------------
export async function deleteGuideAction(
  guideId: string
): Promise<GuideActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(guideId);
  if (error) return { ok: false, message: error.message };
  // profile + guide_assignments cascade away with the auth row.

  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}
