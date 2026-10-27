"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { vividVisionInMessage } from "./vivid-vision";

// SAVING A VIVID VISION TO THE ONE-PAGE PLAN (Jason, 2026-10-27).
//
// The leader's own action, under their own session. The conversation
// has to be one they started, the message one of Aimee's in it holding
// a vivid_vision block, and they have to be able to edit the One-Page
// Plan of the conversation's company: the same people the Vision card's
// Edit offers it to (isAdminForCompany, as /foundation). The text is
// read from the saved message, so what is saved is what Aimee wrote.
//
// It writes company_foundation.vision and nothing else: the upsert
// names only company_id and vision, so the purpose beside it is left
// as it is. RLS on company_foundation is the boundary (company admins,
// assigned guides, system admins; 0245).

export type VividVisionCardState = {
  // What the Vision card holds now, or null when it is empty.
  current: string | null;
  // The card already holds exactly this vision.
  savedThis: boolean;
};

export type SaveVividVisionResult = { ok: true } | { ok: false; message: string };

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function visionSource(
  supabase: Db,
  profileId: string,
  conversationId: string,
  messageId: string
): Promise<{ companyId: string; text: string } | null> {
  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, company_id, created_by")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; company_id: string | null; created_by: string }>();
  if (!convo || convo.created_by !== profileId || !convo.company_id) return null;
  const { data: message } = await supabase
    .from("coaching_messages")
    .select("id, role, content")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle<{ id: string; role: string; content: string }>();
  if (!message || message.role !== "assistant") return null;
  const vision = vividVisionInMessage(message.content);
  return vision ? { companyId: convo.company_id, text: vision.text } : null;
}

async function currentVision(supabase: Db, companyId: string): Promise<string | null> {
  const { data } = await supabase
    .from("company_foundation")
    .select("vision")
    .eq("company_id", companyId)
    .maybeSingle<{ vision: string | null }>();
  const v = data?.vision?.trim();
  return v ? v : null;
}

// Null: not this person's to save.
export async function getVividVisionCardStateAction(
  conversationId: string,
  messageId: string
): Promise<VividVisionCardState | null> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const source = await visionSource(supabase, session.profile.id, conversationId, messageId);
  if (!source || !isAdminForCompany(session.profile, source.companyId)) return null;
  const current = await currentVision(supabase, source.companyId);
  return { current, savedThis: current === source.text };
}

export async function saveVividVisionAction(input: {
  conversationId: string;
  messageId: string;
}): Promise<SaveVividVisionResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const source = await visionSource(supabase, session.profile.id, input.conversationId, input.messageId);
  if (!source) {
    return { ok: false, message: "Only the person who started this conversation can save its vivid vision." };
  }
  if (!isAdminForCompany(session.profile, source.companyId)) {
    return { ok: false, message: "Only people who can edit the One-Page Plan can save it there." };
  }
  // Roles: company_admin, an assigned aims_guide or a portfolio admin
  // switched on as the company's admin, system_admin (RLS, 0245).
  const { data, error } = await supabase
    .from("company_foundation")
    .upsert({ company_id: source.companyId, vision: source.text }, { onConflict: "company_id" })
    .select("company_id");
  if (error || !data || data.length === 0) return { ok: false, message: "Couldn't save. Try again." };
  revalidatePath("/foundation");
  return { ok: true };
}
