"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import type { DxResult } from "./actions";
import { cleanDoc, isProposalSections, proposalTemplate, publishBlocker, PROPOSAL_SECTION_KEYS, PROPOSAL_TITLE, type ProposalSection } from "./proposals";

// Proposals (0312). Allowed roles: system_admin on every action but
// the signature, which is diagnostic_client (the owner it is addressed
// to, checked inside portal_sign_proposal()). requireRole is courtesy;
// 0312's rules and its freeze are the boundary. Writes go through the
// caller's own client and check rows affected.

const REFUSED: DxResult = { ok: false, message: "That didn't save. Reload the page and try again." };
const FROZEN: DxResult = { ok: false, message: "This proposal is signed and published, so it can't change. Make a new version to change it." };

async function admin() {
  const session = await requireRole(["system_admin"]);
  return { session, supabase: await createSupabaseServerClient(getCurrentInstanceConfig()) };
}

// The address and browser of the request, as the app server sees it,
// for the signing record.
async function requestOrigin() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 100) || null;
  const agent = (h.get("user-agent") ?? "").slice(0, 500) || null;
  return { ip, agent };
}

function touched(clientId: string, proposalId?: string) {
  revalidatePath(`/diagnostics/clients/${clientId}`);
  if (proposalId) revalidatePath(`/diagnostics/proposals/${proposalId}`);
  revalidatePath("/portal");
}

export async function createProposalAction(clientId: string): Promise<DxResult> {
  const { session, supabase } = await admin();
  const { data: client } = await supabase
    .from("diagnostic_clients")
    .select("id, owner_name, archived_at")
    .eq("id", clientId)
    .maybeSingle<{ id: string; owner_name: string | null; archived_at: string | null }>();
  if (!client) return { ok: false, message: "That client wasn't found." };
  if (client.archived_at) return { ok: false, message: "Restore the client before writing a proposal." };
  const sections = proposalTemplate({ ownerName: client.owner_name, leadName: session.profile.full_name ?? "" });
  const { data } = await supabase.from("diagnostic_proposals").insert({ client_id: clientId, title: PROPOSAL_TITLE, sections }).select("id");
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) return REFUSED;
  touched(clientId);
  return { ok: true, id };
}

export async function saveProposalTitleAction(id: string, title: string): Promise<DxResult> {
  const { supabase } = await admin();
  const t = title.trim().slice(0, 200);
  if (!t) return { ok: false, message: "Give the proposal a title." };
  const { data, error } = await supabase.from("diagnostic_proposals").update({ title: t }).eq("id", id).is("published_at", null).select("id, client_id");
  if (error?.code === "42501") return FROZEN;
  const row = (data as Array<{ client_id: string }> | null)?.[0];
  if (!row) return REFUSED;
  touched(row.client_id, id);
  return { ok: true };
}

// The whole set of sections at once: the editor holds every section's
// latest document, so two saves in a row never lose one another's work.
export async function saveProposalSectionsAction(id: string, sections: ProposalSection[]): Promise<DxResult> {
  const { supabase } = await admin();
  if (!isProposalSections(sections)) return REFUSED;
  const clean = sections
    .filter((s) => (PROPOSAL_SECTION_KEYS as readonly string[]).includes(s.key))
    .map((s) => ({ key: s.key, title: s.title.trim().slice(0, 120), doc: cleanDoc(s.doc) ?? { type: "doc" } }));
  const { data, error } = await supabase.from("diagnostic_proposals").update({ sections: clean }).eq("id", id).is("published_at", null).select("id, client_id");
  if (error?.code === "42501") return FROZEN;
  const row = (data as Array<{ client_id: string }> | null)?.[0];
  if (!row) return REFUSED;
  touched(row.client_id, id);
  return { ok: true };
}

// The lead signs, and that publishes it: 0312's freeze stamps the time
// and who, copies the client's owner onto the row and fingerprints it.
// Any earlier version still out is withdrawn, so the owner signs this one.
export async function publishProposalAction(id: string, input: { signedName: string; agreed: boolean }): Promise<DxResult> {
  const { supabase } = await admin();
  const name = input.signedName.trim().slice(0, 200);
  if (name.length < 2) return { ok: false, message: "Type your full name to sign." };
  if (!input.agreed) return { ok: false, message: "Tick the box to confirm you're signing for AiMS." };
  const { data: p } = await supabase
    .from("diagnostic_proposals")
    .select("id, client_id, series_id, title, sections, published_at")
    .eq("id", id)
    .maybeSingle<{ id: string; client_id: string; series_id: string; title: string; sections: unknown; published_at: string | null }>();
  if (!p) return { ok: false, message: "That proposal wasn't found." };
  if (p.published_at) return { ok: false, message: "This version is already signed and published." };
  const { data: client } = await supabase.from("diagnostic_clients").select("owner_email").eq("id", p.client_id).maybeSingle<{ owner_email: string | null }>();
  const blocker = publishBlocker({ title: p.title, sections: isProposalSections(p.sections) ? p.sections : [] }, client?.owner_email ?? null);
  if (blocker) return { ok: false, message: blocker };

  const { ip, agent } = await requestOrigin();
  const { data, error } = await supabase
    .from("diagnostic_proposals")
    .update({ lead_signed_name: name, lead_signed_ip: ip, lead_signed_agent: agent, published_at: new Date().toISOString() })
    .eq("id", id)
    .is("published_at", null)
    .select("id");
  if (error?.code === "23514") return { ok: false, message: "Add the owner's email on the client first." };
  if (!data?.length) return REFUSED;
  await supabase
    .from("diagnostic_proposals")
    .update({ withdrawn_at: new Date().toISOString() })
    .eq("series_id", p.series_id)
    .neq("id", id)
    .not("published_at", "is", null)
    .is("withdrawn_at", null);
  touched(p.client_id, id);
  return { ok: true, id };
}

// A new version to change a published proposal: a copy of this one as
// a draft, or the series' draft if one is already open.
export async function newProposalVersionAction(id: string): Promise<DxResult> {
  const { supabase } = await admin();
  const { data: p } = await supabase
    .from("diagnostic_proposals")
    .select("id, client_id, series_id, title, sections")
    .eq("id", id)
    .maybeSingle<{ id: string; client_id: string; series_id: string; title: string; sections: unknown }>();
  if (!p) return { ok: false, message: "That proposal wasn't found." };
  const { data: open } = await supabase.from("diagnostic_proposals").select("id").eq("series_id", p.series_id).is("published_at", null).maybeSingle<{ id: string }>();
  if (open) return { ok: true, id: open.id };
  const { data } = await supabase
    .from("diagnostic_proposals")
    .insert({ client_id: p.client_id, series_id: p.series_id, title: p.title, sections: isProposalSections(p.sections) ? p.sections : [] })
    .select("id");
  const newId = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!newId) return REFUSED;
  touched(p.client_id, id);
  return { ok: true, id: newId };
}

// Only a draft can be deleted (0312); the id returned is the client's,
// for the page to go back to.
export async function deleteProposalDraftAction(id: string): Promise<DxResult> {
  const { supabase } = await admin();
  const { data } = await supabase.from("diagnostic_proposals").delete().eq("id", id).is("published_at", null).select("client_id");
  const row = (data as Array<{ client_id: string }> | null)?.[0];
  if (!row) return { ok: false, message: "Only a draft can be deleted." };
  touched(row.client_id);
  return { ok: true, id: row.client_id };
}

// The owner's signature, through portal_sign_proposal() (0312), for the
// version whose fingerprint they were shown.
export async function signProposalAction(id: string, input: { name: string; hash: string; agreed: boolean }): Promise<DxResult> {
  await requireRole(["diagnostic_client"]);
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, message: "Type your full name to sign." };
  if (!input.agreed) return { ok: false, message: "Tick the box to confirm you agree." };
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { ip, agent } = await requestOrigin();
  const { error } = await supabase.rpc("portal_sign_proposal", { p_id: id, p_name: name, p_hash: input.hash, p_ip: ip, p_agent: agent });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("proposal_signed")) return { ok: false, message: "This proposal is already signed." };
    if (m.includes("proposal_withdrawn")) return { ok: false, message: "This version was replaced by a newer one. Reload the page to see it." };
    if (m.includes("proposal_changed")) return { ok: false, message: "This proposal changed while you were reading it. Reload the page and read it again." };
    if (m.includes("proposal_name")) return { ok: false, message: "Type your full name to sign." };
    if (error.code === "P0002") return { ok: false, message: "That proposal wasn't found." };
    return REFUSED;
  }
  revalidatePath("/portal");
  revalidatePath(`/portal/proposals/${id}`);
  return { ok: true, id };
}
