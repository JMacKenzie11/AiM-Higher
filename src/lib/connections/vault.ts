import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// CONNECTION SECRETS, IN SUPABASE VAULT (0257).
//
// Every outside system a company connects (Google today, HubSpot next)
// keeps its secret in vault.secrets, encrypted with the project's own
// key. Server code reaches it only through the connection_* functions,
// with the instance's service-role client: nobody signed in can read a
// secret, and the database checks who may save one.
//
// This module never logs a secret and never returns one to anything
// that could send it to a browser. The connection row (status, the
// account, a four-character hint) is what a screen shows.

export type Connector = "google" | "hubspot";

export type ConnectionRow = {
  id: string;
  company_id: string;
  connector: Connector;
  status: "active" | "needs_key" | "error";
  account_label: string | null;
  scopes: string[];
  secret_hint: string | null;
  checked_at: string | null;
  last_error: string | null;
};

// The decrypted secret, or null when the company has no such
// connection. Service role only: the function refuses anyone else.
export async function readConnectionSecret(
  admin: SupabaseClient,
  companyId: string,
  connector: Connector
): Promise<string | null> {
  const { data, error } = await admin.rpc("connection_secret", {
    p_company_id: companyId,
    p_connector: connector,
  });
  if (error) throw new Error(`Couldn't read the ${connector} connection: ${error.message}`);
  return typeof data === "string" ? data : null;
}

// Saves or replaces a company's secret from server code that has
// already checked the person (the Google sign-in callback).
export async function saveConnectionSecretAsService(
  admin: SupabaseClient,
  input: {
    companyId: string;
    connector: Connector;
    secret: string;
    hint: string | null;
    accountLabel: string | null;
    scopes: string[];
    actorProfileId: string | null;
  }
): Promise<void> {
  const { error } = await admin.rpc("connection_put_service", {
    p_company_id: input.companyId,
    p_connector: input.connector,
    p_secret: input.secret,
    p_hint: input.hint,
    p_account_label: input.accountLabel,
    p_scopes: input.scopes,
    p_actor: input.actorProfileId,
  });
  if (error) throw new Error(`Couldn't store the ${input.connector} credential: ${error.message}`);
}

// Writes back a refreshed secret for a connection that already exists
// (a Google access token after a refresh). No event: it happens on
// every ingest.
export async function refreshConnectionSecret(
  admin: SupabaseClient,
  companyId: string,
  connector: Connector,
  secret: string
): Promise<void> {
  const { error } = await admin.rpc("connection_refresh_secret", {
    p_company_id: companyId,
    p_connector: connector,
    p_secret: secret,
  });
  if (error) throw new Error(`Couldn't update the ${connector} credential: ${error.message}`);
}

// The connection row, without the secret.
export async function loadConnection(
  admin: SupabaseClient,
  companyId: string,
  connector: Connector
): Promise<ConnectionRow | null> {
  const { data } = await admin
    .from("connections")
    .select("id, company_id, connector, status, account_label, scopes, secret_hint, checked_at, last_error")
    .eq("company_id", companyId)
    .eq("connector", connector)
    .maybeSingle<ConnectionRow>();
  return data ?? null;
}

// ---- Google's secret ----------------------------------------------

// What a Google connection's secret holds: the refresh token, and the
// last access token with its expiry so a run inside the hour skips the
// token endpoint. Stored as JSON in one vault secret.
export type GoogleSecret = {
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
};

export function parseGoogleSecret(raw: string | null): GoogleSecret | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GoogleSecret>;
    if (typeof v.refresh_token !== "string" || !v.refresh_token) return null;
    return {
      refresh_token: v.refresh_token,
      access_token: typeof v.access_token === "string" ? v.access_token : null,
      access_token_expires_at: typeof v.access_token_expires_at === "string" ? v.access_token_expires_at : null,
    };
  } catch {
    return null;
  }
}

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"];
