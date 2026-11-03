"use server";

import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { currentRequestOrigin } from "@/lib/instances/origin";
import { loadVisionForCaller } from "@/lib/foundation/vivid-vision-source";
import { googleDocsConfigured } from "./config";
import { GoogleDocsReconnect, readGoogleDocsSecret, removeGoogleDocsConnection } from "./connection";
import { googleDocsOAuthClient } from "./config";
import { saveVisionToGoogleDoc } from "./save-vision";

// SAVE TO GOOGLE DOCS (Jason, 2026-11-03; 0318). For anyone who can
// see the Vivid Vision card, as Download PDF is: the vision is read as
// the caller (loadVisionForCaller), and the doc goes to the caller's
// OWN Drive through their own Google connection. Nothing in AiMS-HQ
// changes but the record of which doc it was.

export type GoogleDocsCardState =
  | { enabled: false }
  | { enabled: true; connectedAs: string | null; connected: boolean; hasDoc: boolean; docUrl: string | null };

export type SaveToGoogleDocResult =
  | { ok: true; url: string; updated: boolean }
  | { ok: false; connect: true }
  | { ok: false; message: string };

export async function getGoogleDocsCardStateAction(conversationId: string): Promise<GoogleDocsCardState> {
  if (!googleDocsConfigured()) return { enabled: false };
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  // The person's own rows, through 0318's policies. Missing tables
  // (before 0318) read as not connected.
  const [{ data: conn }, { data: link }] = await Promise.all([
    supabase.from("google_docs_connections").select("account_email").eq("profile_id", session.profile.id).maybeSingle<{ account_email: string | null }>(),
    supabase.from("vivid_vision_google_docs").select("file_id").eq("conversation_id", conversationId).eq("profile_id", session.profile.id).maybeSingle<{ file_id: string }>(),
  ]);
  return {
    enabled: true,
    connected: Boolean(conn),
    connectedAs: conn?.account_email ?? null,
    hasDoc: Boolean(link),
    // Always shown once there is one, so the card says where it went.
    docUrl: link ? `https://docs.google.com/document/d/${encodeURIComponent(link.file_id)}/edit` : null,
  };
}

export async function saveVisionToGoogleDocAction(input: { conversationId: string; messageId: string }): Promise<SaveToGoogleDocResult> {
  if (!googleDocsConfigured()) return { ok: false, message: "Save to Google Docs isn't set up here." };
  const session = await requireProfile();
  const vision = await loadVisionForCaller(input.conversationId, input.messageId);
  if (!vision) return { ok: false, message: "That vision wasn't found. Reload the page and try again." };
  try {
    return await saveVisionToGoogleDoc({
      profileId: session.profile.id,
      conversationId: input.conversationId,
      origin: await currentRequestOrigin(),
      ...vision,
    });
  } catch (err) {
    if (err instanceof GoogleDocsReconnect) return { ok: false, connect: true };
    console.error("[google-docs] save failed", { conversationId: input.conversationId, message: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: "Google Docs didn't take it this time. Try again in a minute." };
  }
}

// Disconnect: Google is told first (best effort), then the person's
// own connection goes, through the function that acts on auth.uid()
// alone. Their saved doc links stay, for reconnecting the same account.
export async function disconnectGoogleDocsAction(): Promise<{ ok: boolean }> {
  const session = await requireProfile();
  const secret = await readGoogleDocsSecret(session.profile.id);
  if (secret && googleDocsConfigured()) {
    try {
      await googleDocsOAuthClient(await currentRequestOrigin()).revokeToken(secret.refresh_token);
    } catch {
      // Already revoked, or Google is unreachable: ours goes anyway.
    }
  }
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { error } = await supabase.rpc("google_docs_disconnect");
  if (error) await removeGoogleDocsConnection(session.profile.id);
  return { ok: true };
}
