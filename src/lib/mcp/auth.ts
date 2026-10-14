import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { ROUTE_KEY_HEADER } from "./route-key";

// AN OUTSIDE ASSISTANT'S TOKEN, checked and turned into a client that
// acts as the person.
//
// Accepted only when it is a token Supabase's OAuth server issued to an
// assistant: a valid signature from THIS instance's project, its issuer,
// and a client_id claim. An ordinary app sign-in has no client_id and
// is refused here, so a person's own session token cannot be replayed
// against the MCP route, and the MCP route never sees anything but an
// assistant (the database's allow list, 0270, keys off the same claim).
//
// The client it returns sends that token and nothing else: never the
// service role. Every read and write it makes runs as the person,
// through RLS and the allow list. It also sends this instance's route
// secret (0275, lib/mcp/route-key.ts), which is how the database knows
// the request came through /api/mcp and so was logged and rate limited.
// It is not a credential for anything: without the person's token it
// reaches nothing, and the assistant never sees it. With no secret set
// for the instance the header is left off, and the database refuses
// every assistant there (fail closed).

export type AssistantCaller = {
  db: SupabaseClient;
  userId: string;
  clientId: string;
  expiresAt?: number;
};

export async function assistantClient(token: string): Promise<SupabaseClient> {
  const instance = await getCurrentInstanceConfig();
  return createClient(instance.supabaseUrl, instance.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(instance.mcpRouteSecret ? { [ROUTE_KEY_HEADER]: instance.mcpRouteSecret } : {}),
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function verifyAssistantToken(token: string | undefined): Promise<AssistantCaller | null> {
  if (!token) return null;
  const instance = await getCurrentInstanceConfig();
  const db = await assistantClient(token);
  // getClaims verifies the signature: against the project's published
  // keys for an asymmetric token, or by asking the Auth server for a
  // symmetric one. A forged or expired token comes back as an error.
  const { data, error } = await db.auth.getClaims(token);
  if (error || !data?.claims) return null;
  const claims = data.claims as Record<string, unknown>;
  const clientId = typeof claims.client_id === "string" ? claims.client_id : "";
  const userId = typeof claims.sub === "string" ? claims.sub : "";
  const issuer = typeof claims.iss === "string" ? claims.iss : "";
  if (!clientId || !userId) return null;
  if (issuer !== `${instance.supabaseUrl}/auth/v1`) return null;
  return {
    db,
    userId,
    clientId,
    expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
  };
}
