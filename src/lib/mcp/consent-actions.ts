"use server";

import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { mcpEnabled, mcpOpenTo } from "./switch";
import { isAuthorizationId } from "./consent-path";

// The person's answer to an outside assistant's sign-in request.
//
// Both run on the person's own session (the cookie client), so Supabase
// records the grant against them and nobody else. Approving is refused
// on the server, not only hidden on the page, while the switch is off or
// the person is not in the audience (lib/mcp/switch.ts). Declining is
// always allowed: it tells the assistant no.

export type ConsentResult = { ok: false; message: string };

async function answer(formData: FormData, approve: boolean): Promise<ConsentResult> {
  if (!mcpEnabled()) return { ok: false, message: "Outside assistants aren't available." };
  const session = await requireProfile();
  const id = String(formData.get("authorization_id") ?? "");
  if (!isAuthorizationId(id)) return { ok: false, message: "That sign-in request isn't valid. Start again from your assistant." };
  if (approve && !mcpOpenTo(session.profile.role)) {
    return { ok: false, message: "Outside assistants aren't open to your account yet." };
  }
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) {
    return { ok: false, message: "That sign-in request has expired. Start again from your assistant." };
  }
  redirect(data.redirect_url);
}

export async function approveAssistantAction(_prev: ConsentResult | undefined, formData: FormData): Promise<ConsentResult> {
  return answer(formData, true);
}

export async function declineAssistantAction(_prev: ConsentResult | undefined, formData: FormData): Promise<ConsentResult> {
  return answer(formData, false);
}
