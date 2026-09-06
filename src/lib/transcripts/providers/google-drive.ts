import "server-only";

import { google, type drive_v3 } from "googleapis";
// Use google.auth.OAuth2 directly — importing OAuth2Client from
// google-auth-library returns a class from a separate copy of the
// package that TypeScript won't accept in google.drive({ auth }).
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// Re-exported for backwards compatibility. New callers should import
// from ./drive-url directly — importing it from here drags googleapis
// into the caller's module graph, which is the whole reason the parser
// was moved out.
export { parseGoogleFolderId } from "./drive-url";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
import type {
  DownloadedFile,
  ListedFile,
  TranscriptProvider,
} from "../provider";
import type { OAuthCredentials, TranscriptSource } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// OAuth-based Google Drive provider. The service-account path was
// blocked by Google's Secure by Default managed policies (see
// migration 0109). Instead the system admin signs in once via
// /api/oauth/google/start; we store the resulting refresh token and
// use it to mint access tokens per ingest cycle.
//
// Clients share their transcript folder with the connected Google
// account's email address (Viewer). That address is displayed on
// /admin/transcripts once the connection is set up.

// openid + email are required so the OIDC userinfo call in
// exchangeCodeAndPersist returns the connected account address.
const READONLY_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.readonly",
];

export const SUPPORTED_MIMES = new Set<string>([
  "application/vnd.google-apps.document", // Google Doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "text/vtt",
  "text/plain",
]);

export function getOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI."
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildConsentUrl(state: string): string {
  const client = getOAuthClient();
  // Access type offline + prompt consent guarantees Google issues a
  // refresh token even for repeat authorizations.
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: READONLY_SCOPES,
    state,
  });
}

// Called by the callback route. Returns the connected user's email
// so we can display it on the setup page and clients know which
// address to share folders with. Scoped per company — each company
// stores its own refresh token, so different companies can point at
// Drive folders owned by different Google Workspaces.
export async function exchangeCodeAndPersist(
  code: string,
  companyId: string
): Promise<string> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke prior access at https://myaccount.google.com/permissions and try again."
    );
  }

  client.setCredentials(tokens);
  const info = await client.request<{ email: string }>({
    url: "https://openidconnect.googleapis.com/v1/userinfo",
  });
  const email = info.data.email;
  if (!email) throw new Error("Google didn't return the connected email.");

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error: upsertError } = await admin
    .from("oauth_credentials")
    .upsert(
      {
        provider: "google_drive",
        company_id: companyId,
        account_email: email,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token ?? null,
        access_token_expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
      },
      { onConflict: "provider,company_id" }
    );
  // Supabase doesn't throw on DB errors — check and re-raise so the
  // callback surfaces the real reason instead of a spurious "success"
  // flash while the row was never written (e.g. migration 0110 not
  // applied, so company_id doesn't exist yet).
  if (upsertError) {
    throw new Error(
      `Couldn't store the Google credential: ${upsertError.message}`
    );
  }
  return email;
}

// Loads the stored refresh token for a company and returns an
// OAuth2Client with credentials set. google-auth-library refreshes
// the access token automatically when the SDK detects expiry.
async function authenticatedClient(companyId: string): Promise<OAuth2Client> {
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data } = await admin
    .from("oauth_credentials")
    .select("*")
    .eq("provider", "google_drive")
    .eq("company_id", companyId)
    .maybeSingle<OAuthCredentials>();
  if (!data) {
    throw new Error(
      "This company hasn't connected a Google account yet. Connect one from its transcripts panel."
    );
  }
  const client = getOAuthClient();
  client.setCredentials({
    refresh_token: data.refresh_token,
    access_token: data.access_token ?? undefined,
    expiry_date: data.access_token_expires_at
      ? new Date(data.access_token_expires_at).getTime()
      : undefined,
  });
  // Persist refreshed access tokens so subsequent runs skip the
  // token endpoint round trip.
  client.on("tokens", async (tokens) => {
    if (!tokens.access_token) return;
    await admin
      .from("oauth_credentials")
      .update({
        access_token: tokens.access_token,
        access_token_expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
      })
      .eq("provider", "google_drive")
      .eq("company_id", companyId);
  });
  return client;
}

async function driveClient(companyId: string): Promise<drive_v3.Drive> {
  const auth = await authenticatedClient(companyId);
  return google.drive({ version: "v3", auth });
}

// Debug helper: raw file listing for a source, ignoring the cursor
// and MIME filters entirely. Used by the transcripts panel's
// "Preview Drive listing" button so an admin can see exactly what
// the OAuth-connected account can see through the API — helps
// diagnose "why did nothing get ingested" cases where the folder
// looks populated in the browser but the API returns empty.
export async function debugListFolder(source: TranscriptSource): Promise<{
  ok: true;
  files: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    ownerEmail: string | null;
  }>;
} | { ok: false; message: string }> {
  if (!source.company_id) {
    return { ok: false, message: "Source has no company_id." };
  }
  try {
    const drive = await driveClient(source.company_id);
    const res = await drive.files.list({
      q: `'${source.folder_id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: "files(id, name, mimeType, modifiedTime, owners(emailAddress))",
      orderBy: "modifiedTime desc",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = (res.data.files ?? []).map((f) => ({
      id: f.id ?? "",
      name: f.name ?? "",
      mimeType: f.mimeType ?? "",
      modifiedTime: f.modifiedTime ?? "",
      ownerEmail: f.owners?.[0]?.emailAddress ?? null,
    }));
    return { ok: true, files };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function verifyFolderAccess(
  folderId: string,
  companyId: string
): Promise<{ folderName: string }> {
  const drive = await driveClient(companyId);
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType",
      supportsAllDrives: true,
    });
    if (res.data.mimeType !== "application/vnd.google-apps.folder") {
      throw new Error("That link points to a file, not a folder.");
    }
    return { folderName: res.data.name ?? "(unnamed folder)" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|404/i.test(msg)) {
      const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
      const { data } = await admin
        .from("oauth_credentials")
        .select("account_email")
        .eq("provider", "google_drive")
        .eq("company_id", companyId)
        .maybeSingle<Pick<OAuthCredentials, "account_email">>();
      const acct = data?.account_email ?? "the connected account";
      throw new Error(
        `${acct} can't reach that folder. Share it with ${acct} as Viewer and try again.`
      );
    }
    throw new Error(`Couldn't verify the folder: ${msg}`);
  }
}

async function listNewFiles(source: TranscriptSource): Promise<{
  files: ListedFile[];
  nextCursor: string | null;
}> {
  if (!source.company_id) {
    throw new Error("Shared-scope sources are no longer supported.");
  }
  const drive = await driveClient(source.company_id);

  const parts: string[] = [
    `'${source.folder_id}' in parents`,
    "trashed = false",
    "mimeType != 'application/vnd.google-apps.folder'",
  ];
  if (source.cursor) parts.push(`modifiedTime > '${source.cursor}'`);
  const q = parts.join(" and ");

  const files: ListedFile[] = [];
  let pageToken: string | undefined;
  let latestModified = source.cursor ?? null;

  do {
    const res = await drive.files.list({
      q,
      fields: "nextPageToken, files(id, name, modifiedTime, mimeType)",
      orderBy: "modifiedTime",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const batch = res.data.files ?? [];
    for (const f of batch) {
      if (!f.id || !f.name || !f.modifiedTime) continue;
      if (!SUPPORTED_MIMES.has(f.mimeType ?? "")) continue;
      files.push({
        fileId: f.id,
        name: f.name,
        modifiedAt: f.modifiedTime,
      });
      if (!latestModified || f.modifiedTime > latestModified) {
        latestModified = f.modifiedTime;
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { files, nextCursor: latestModified };
}

async function downloadFile(
  source: TranscriptSource,
  fileId: string
): Promise<DownloadedFile> {
  if (!source.company_id) {
    throw new Error("Shared-scope sources are no longer supported.");
  }
  const drive = await driveClient(source.company_id);

  const meta = await drive.files.get({
    fileId,
    fields: "id, name, mimeType",
    supportsAllDrives: true,
  });
  const mimeType = meta.data.mimeType ?? "application/octet-stream";
  const name = meta.data.name ?? fileId;

  if (mimeType === "application/vnd.google-apps.document") {
    const res = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "arraybuffer" }
    );
    return {
      buffer: Buffer.from(res.data as ArrayBuffer),
      mimeType: "text/plain",
      name,
    };
  }

  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return {
    buffer: Buffer.from(res.data as ArrayBuffer),
    mimeType,
    name,
  };
}

export const googleDriveProvider: TranscriptProvider = {
  listNewFiles,
  downloadFile,
  verifyFolderAccess,
};

// Reads a company's currently-connected account for display
// purposes. Null when this company hasn't completed the handshake.
export async function getConnectedGoogleAccount(
  companyId: string
): Promise<string | null> {
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data } = await admin
    .from("oauth_credentials")
    .select("account_email")
    .eq("provider", "google_drive")
    .eq("company_id", companyId)
    .maybeSingle<Pick<OAuthCredentials, "account_email">>();
  return data?.account_email ?? null;
}
