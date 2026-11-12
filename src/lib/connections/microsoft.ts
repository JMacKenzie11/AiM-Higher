import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { APP_URL } from "@/lib/supabase/env";
import {
  parseOAuthSecret,
  readConnectionSecret,
  refreshConnectionSecret,
  saveConnectionSecretAsService,
  type OAuthSecret,
} from "./vault";

// MICROSOFT 365, for Teams meeting transcripts (Jason, 2026-11-12;
// 0325). One Entra app, "AiMS HQ", registered once by AiMS as
// MULTI-TENANT: every client signs in from their own Microsoft 365
// organisation, and their own admin approves the app there once.
//
// DELEGATED, NOT APPLICATION, PERMISSIONS. AiMS reads as the person
// who connected, so it reaches the meetings THAT PERSON can reach and
// nothing else in the client's organisation. Application permissions
// would read every meeting in the tenant, which no client should be
// asked to grant for one weekly meeting.
//
// The one permission that needs the client's admin is
// OnlineMeetingTranscript.Read.All. Microsoft marks it admin-consent
// even when delegated, so an ordinary person signing in sees "Need
// admin approval" until their admin has approved AiMS HQ once. So
// the setup on Company settings is two steps (Jason, 2026-11-12):
// **Approve AiMS HQ**, signed in as the company's Microsoft 365 admin
// (adminConsentUrl below), and then **Connect Microsoft 365**, which
// appears once Microsoft sends them back approved.
//
// The client secret expires (24 months, set in Entra). When it does,
// every refresh fails with AADSTS7000222 and connections show the
// error: the fix is a new secret in Entra and in Vercel, not a
// reconnect by each client.
//
// Tokens live in Supabase Vault as the company's 'microsoft'
// connection, the same as Google's.

// What each scope is for, so the list can be checked against the app
// registration in Entra (they must match):
//   openid, email, profile  sign-in, and who connected
//   offline_access          a refresh token, so the cron can read later
//   User.Read               the connected account's address
//   Calendars.Read          the meeting picker: their calendar's Teams meetings
//   OnlineMeetings.Read     a calendar meeting's join link -> its meeting id
//   OnlineMeetingTranscript.Read.All  the transcripts themselves
export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Calendars.Read",
  "https://graph.microsoft.com/OnlineMeetings.Read",
  "https://graph.microsoft.com/OnlineMeetingTranscript.Read.All",
];

// "organizations": any work or school account, never a personal one.
// Personal Microsoft accounts have no Teams transcripts to read.
const AUTHORITY = "https://login.microsoftonline.com/organizations";
export const GRAPH = "https://graph.microsoft.com/v1.0";

// Whether AiMS has a Microsoft app at all. Until it does the
// Microsoft option is hidden, the same rule as Save to Google Docs.
export function microsoftConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

function config() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Microsoft 365 isn't set up for AiMS yet. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.");
  }
  // One path, on each instance's own address. All three (production,
  // Promise One, localhost) are registered in Entra; a fourth instance
  // needs its address added there before its people can connect.
  const redirectUri = `${APP_URL()}/api/oauth/microsoft/callback`;
  return { clientId, clientSecret, redirectUri };
}

export function buildMicrosoftConsentUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const url = new URL(`${AUTHORITY}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  url.searchParams.set("state", state);
  // Always show the account picker: whoever connects for a company
  // is often signed in to Microsoft as somebody else (their own
  // company, or AiMS).
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

// Microsoft's page where a Microsoft 365 admin approves AiMS HQ for
// their whole organisation, once. Reached through
// /api/oauth/microsoft/approve, which sets the state cookie: the
// callback reads the company from it and sends the person back to its
// settings with Connect showing. Nothing is stored in AiMS: the
// approval lives in the client's own Microsoft settings.
export function adminConsentUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const url = new URL(`${AUTHORITY}/v2.0/adminconsent`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", MICROSOFT_SCOPES.filter((s) => s.startsWith("https://")).join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = config();
  const res = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }),
    cache: "no-store",
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

// Microsoft's errors are long and start with a code. The code is what
// support needs; the rest is shown as Microsoft wrote it.
export function microsoftErrorMessage(r: TokenResponse): string {
  const text = r.error_description ?? r.error ?? "Microsoft refused the request.";
  return text.split(/\r?\n/)[0].replace(/ Trace ID:.*$/, "");
}

// True when Microsoft's answer means "this organisation's admin has
// not approved AiMS HQ yet": AADSTS65001 (no consent), AADSTS90094
// (admin approval required). The callback shows the admin link then.
export function needsAdminApproval(text: string | null | undefined): boolean {
  return /AADSTS(65001|90094|90008)|admin approval|consent_required/i.test(text ?? "");
}

function secretFrom(r: TokenResponse, previousRefresh: string | null): OAuthSecret {
  const refresh = r.refresh_token ?? previousRefresh;
  if (!refresh || !r.access_token) {
    throw new Error(microsoftErrorMessage(r));
  }
  return {
    refresh_token: refresh,
    access_token: r.access_token,
    access_token_expires_at: r.expires_in
      ? new Date(Date.now() + r.expires_in * 1000).toISOString()
      : null,
  };
}

// Called by the callback route. Returns the connected account's
// address for the Connections card.
export async function exchangeMicrosoftCodeAndPersist(
  code: string,
  companyId: string,
  actorProfileId: string | null = null
): Promise<string> {
  const { redirectUri } = config();
  const r = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: MICROSOFT_SCOPES.join(" "),
  });
  const secret = secretFrom(r, null);

  const me = await graphFetch<{ mail?: string | null; userPrincipalName?: string }>(secret.access_token!, "/me?$select=mail,userPrincipalName");
  const account = me.mail || me.userPrincipalName;
  if (!account) throw new Error("Microsoft didn't say which account connected.");

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  await saveConnectionSecretAsService(admin, {
    companyId,
    connector: "microsoft",
    secret: JSON.stringify(secret),
    hint: null,
    accountLabel: account,
    scopes: MICROSOFT_SCOPES,
    actorProfileId,
  });
  return account;
}

// A fresh access token for a company, refreshing (and storing the
// refresh token Microsoft hands back) when the stored one is within
// two minutes of expiring.
export async function microsoftAccessToken(companyId: string): Promise<string> {
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const stored = parseOAuthSecret(await readConnectionSecret(admin, companyId, "microsoft"));
  if (!stored) {
    throw new Error("This company hasn't connected Microsoft 365 yet. Connect it under External connections.");
  }
  const expires = stored.access_token_expires_at ? Date.parse(stored.access_token_expires_at) : 0;
  if (stored.access_token && expires - Date.now() > 120_000) return stored.access_token;

  const r = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: stored.refresh_token,
    scope: MICROSOFT_SCOPES.join(" "),
  });
  const next = secretFrom(r, stored.refresh_token);
  try {
    await refreshConnectionSecret(admin, companyId, "microsoft", JSON.stringify(next));
  } catch (err) {
    // Unlike Google, losing this write can matter: Microsoft may have
    // rotated the refresh token. Logged loudly; the old one usually
    // keeps working for a while, and the next run tries again.
    console.error("[microsoft] refreshed token not stored:", err instanceof Error ? err.message : err);
  }
  return next.access_token!;
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
  }
}

export async function graphFetch<T>(
  accessToken: string,
  pathOrUrl: string,
  init: { accept?: string; raw?: false } = {}
): Promise<T> {
  const res = await graphRequest(accessToken, pathOrUrl, init.accept);
  return (await res.json()) as T;
}

export async function graphRequest(accessToken: string, pathOrUrl: string, accept?: string): Promise<Response> {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, ...(accept ? { accept } : {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string; innerError?: { code?: string }; innererror?: { code?: string } };
    } | null;
    // Graph puts the specific reason one level down at times (a 403
    // whose code is "Forbidden" and whose inner code says why), so the
    // most specific code wins. SpeakerAttributionNotAllowed is one the
    // Teams reader acts on.
    const code =
      body?.error?.innerError?.code ?? body?.error?.innererror?.code ?? body?.error?.code ?? null;
    throw new GraphError(body?.error?.message ?? `Microsoft Graph answered ${res.status}.`, res.status, code);
  }
  return res;
}

// The company's connected Microsoft account, for display. Null when
// it has not connected. Read with the service role, as Google's is
// (getConnectedGoogleAccount): the transcripts card shows it to the
// people who manage transcript sources.
export async function getConnectedMicrosoftAccount(companyId: string): Promise<string | null> {
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data } = await admin
    .from("connections")
    .select("account_label")
    .eq("company_id", companyId)
    .eq("connector", "microsoft")
    .maybeSingle<{ account_label: string | null }>();
  return data?.account_label ?? null;
}
