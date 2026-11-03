import "server-only";

import { google } from "googleapis";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { parseGoogleSecret, type GoogleSecret } from "@/lib/connections/vault";
import { googleDocsOAuthClient } from "./config";

// A person's Google Docs connection (0318). The refresh token and the
// last access token are one vault secret, read and written only
// through the google_docs_* functions with the service-role client.
// Nothing here logs a token or returns one toward a browser.

async function admin() {
  return createSupabaseAdminClient(getCurrentInstanceConfig());
}

export async function saveGoogleDocsSecret(profileId: string, secret: GoogleSecret, email: string | null): Promise<void> {
  const db = await admin();
  const { error } = await db.rpc("google_docs_put_service", {
    p_profile_id: profileId,
    p_secret: JSON.stringify(secret),
    p_account_email: email,
  });
  if (error) throw new Error(`Couldn't store the Google connection: ${error.message}`);
}

export async function readGoogleDocsSecret(profileId: string): Promise<GoogleSecret | null> {
  const db = await admin();
  const { data, error } = await db.rpc("google_docs_secret", { p_profile_id: profileId });
  // Before 0318 reaches the instance the function is missing: not connected.
  if (error) return null;
  return parseGoogleSecret(typeof data === "string" ? data : null);
}

export async function removeGoogleDocsConnection(profileId: string): Promise<void> {
  const db = await admin();
  await db.rpc("google_docs_remove_service", { p_profile_id: profileId });
}

// Google refused the refresh token: revoked from the Google account,
// unused for six months, or a workplace policy. The connection is
// removed, so the next press asks them to connect again.
export class GoogleDocsReconnect extends Error {}

// An OAuth client holding a working access token, refreshed and
// written back when the stored one is within a minute of expiring.
// Null when the person has never connected.
export async function authorisedClient(profileId: string, origin: string) {
  const secret = await readGoogleDocsSecret(profileId);
  if (!secret) return null;
  const client = googleDocsOAuthClient(origin);
  const fresh = secret.access_token && secret.access_token_expires_at && Date.parse(secret.access_token_expires_at) - Date.now() > 60_000;
  if (fresh) {
    client.setCredentials({ refresh_token: secret.refresh_token, access_token: secret.access_token });
    return client;
  }
  client.setCredentials({ refresh_token: secret.refresh_token });
  try {
    const { credentials } = await client.refreshAccessToken();
    const next: GoogleSecret = {
      refresh_token: credentials.refresh_token ?? secret.refresh_token,
      access_token: credentials.access_token ?? null,
      access_token_expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
    };
    await saveGoogleDocsSecret(profileId, next, null);
    client.setCredentials({ refresh_token: next.refresh_token, access_token: next.access_token });
    return client;
  } catch (err) {
    if (/invalid_grant|unauthorized_client|invalid_client/i.test(String((err as { message?: string })?.message ?? err))) {
      await removeGoogleDocsConnection(profileId);
      throw new GoogleDocsReconnect("Google asked you to connect again.");
    }
    throw err;
  }
}

// The callback's exchange: tokens for the code, and the account's
// address from Google's userinfo (openid + email).
export async function exchangeGoogleDocsCode(code: string, origin: string): Promise<{ secret: GoogleSecret; email: string | null }> {
  const client = googleDocsOAuthClient(origin);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("no_refresh_token");
  client.setCredentials(tokens);
  let email: string | null = null;
  try {
    const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
    email = data.email ?? null;
  } catch {
    email = null;
  }
  return {
    secret: {
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token ?? null,
      access_token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    },
    email,
  };
}
