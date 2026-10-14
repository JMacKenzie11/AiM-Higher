"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// CONNECTED ASSISTANTS (Phase 4). A person sees the outside assistants
// they have allowed, and revokes any of them. Both run on the person's
// own session through Supabase's OAuth server, so nobody sees or
// revokes anyone else's. Revoking deletes the assistant's sessions and
// refresh tokens; 0272 makes its access token stop at the database the
// same moment, and the MCP route refuses it too.

export type ConnectedAssistant = {
  clientId: string;
  name: string;
  connectedAt: string;
  // From assistant_actions (0273), which the person reads for their own
  // rows: when it last did something, and how much in 30 days.
  lastUsedAt: string | null;
  callsLast30Days: number;
};

export async function listMyAssistantsAction(): Promise<ConnectedAssistant[]> {
  await requireProfile();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  // Where the OAuth server is off, there is nothing to list: an error
  // here reads as no assistants, never as a broken page.
  const { data: grants, error } = await db.auth.oauth.listGrants();
  if (error || !grants || grants.length === 0) return [];

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: actions } = await db
    .from("assistant_actions")
    .select("client_id, created_at")
    .in("client_id", grants.map((g) => g.client.id))
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  const rows = (actions ?? []) as Array<{ client_id: string; created_at: string }>;

  return grants
    .map((g) => {
      const mine = rows.filter((r) => r.client_id === g.client.id);
      return {
        clientId: g.client.id,
        name: g.client.name || "An outside assistant",
        connectedAt: g.granted_at,
        lastUsedAt: mine[0]?.created_at ?? null,
        callsLast30Days: mine.length,
      };
    })
    .sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
}

export async function revokeAssistantAction(clientId: string): Promise<{ ok: boolean; message?: string }> {
  await requireProfile();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return { ok: false, message: "That isn't an AI app id." };
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { error } = await db.auth.oauth.revokeGrant({ clientId });
  if (error) return { ok: false, message: "Couldn't disconnect that AI app. Try again." };
  revalidatePath("/profile");
  return { ok: true };
}
