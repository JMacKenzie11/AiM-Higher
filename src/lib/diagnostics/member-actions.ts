"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { createPendingUser } from "@/lib/auth/provision-user";
import { dispatchInvite } from "@/lib/auth/users";
import type { DxResult } from "./actions";

// The people at a Capacity Diagnostic client who sign in to see their
// dashboard (0307). Allowed roles: system_admin, on every action
// (requireRole as courtesy; row security in 0307 is the boundary for
// the membership row). The auth user and its profile are made and
// removed with the admin client, as every invite in AiMS HQ is; the
// membership row goes through the caller's own client.

async function caller() {
  const session = await requireRole(["system_admin"]);
  return { session, supabase: await createSupabaseServerClient(getCurrentInstanceConfig()) };
}

function touched(clientId: string) {
  revalidatePath(`/diagnostics/clients/${clientId}`);
}

export async function inviteClientPersonAction(clientId: string, input: { name: string; email: string }): Promise<DxResult & { warning?: string }> {
  const { session, supabase } = await caller();
  const name = input.name.trim().slice(0, 200);
  const email = input.email.trim().toLowerCase();
  if (!name || !email) return { ok: false, message: "Enter their name and email." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, message: "That doesn't look like an email address." };

  const { data: client } = await supabase.from("diagnostic_clients").select("id, archived_at").eq("id", clientId).maybeSingle<{ id: string; archived_at: string | null }>();
  if (!client) return { ok: false, message: "That client wasn't found." };
  if (client.archived_at) return { ok: false, message: "Restore the client before giving anyone access." };

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const created = await createPendingUser({ admin, email, fullName: name, role: "diagnostic_client", companyId: null });
  if (!created.ok) return created;

  const { data: member } = await supabase.from("diagnostic_client_members").insert({ profile_id: created.profileId, client_id: clientId }).select("profile_id");
  if (!member?.length) {
    // No membership, no use for the account: take it back rather than
    // leave a person who can sign in to nothing.
    await admin.auth.admin.deleteUser(created.profileId).catch(() => {});
    return { ok: false, message: "That didn't save. Reload the page and try again." };
  }
  touched(clientId);

  const invite = await dispatchInvite(created.profileId, email, session.profile.id);
  if (!invite.ok) return { ok: true, warning: `Added, but the invite email didn't send: ${invite.message}` };
  return { ok: true };
}

// The member row says which client a person belongs to; reading it
// through the caller's client proves the person is this client's.
async function memberOf(supabase: Awaited<ReturnType<typeof caller>>["supabase"], clientId: string, profileId: string) {
  const { data } = await supabase
    .from("diagnostic_client_members")
    .select("profile_id")
    .eq("profile_id", profileId)
    .eq("client_id", clientId)
    .maybeSingle<{ profile_id: string }>();
  if (!data) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, status")
    .eq("id", profileId)
    .maybeSingle<{ id: string; role: string; status: string }>();
  return profile?.role === "diagnostic_client" ? profile : null;
}

export async function resendClientInviteAction(clientId: string, profileId: string): Promise<DxResult> {
  const { session, supabase } = await caller();
  const person = await memberOf(supabase, clientId, profileId);
  if (!person) return { ok: false, message: "That person wasn't found." };
  if (person.status !== "pending") return { ok: false, message: "They have already signed in." };
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: user } = await admin.auth.admin.getUserById(profileId);
  if (!user?.user?.email) return { ok: false, message: "Couldn't find their email." };
  const sent = await dispatchInvite(profileId, user.user.email, session.profile.id);
  if (!sent.ok) return sent;
  touched(clientId);
  return { ok: true };
}

// Removing access deletes the account: a diagnostic client's person
// has nothing else in AiMS HQ, and the membership row goes with it
// (ON DELETE CASCADE).
export async function removeClientPersonAction(clientId: string, profileId: string): Promise<DxResult> {
  const { supabase } = await caller();
  const person = await memberOf(supabase, clientId, profileId);
  if (!person) return { ok: false, message: "That person wasn't found." };
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin.auth.admin.deleteUser(profileId);
  if (error) return { ok: false, message: "Couldn't remove their access. Try again." };
  touched(clientId);
  return { ok: true };
}
