import "server-only";

import { google, type drive_v3 } from "googleapis";
import type {
  DownloadedFile,
  ListedFile,
  TranscriptProvider,
} from "../provider";
import type { TranscriptSource } from "@/lib/types";

// Platform-owned Google service account. The user shares each
// transcript folder with the address stored in GOOGLE_SERVICE_ACCOUNT_EMAIL
// (Viewer is enough). We hold the JSON key base64-encoded in
// GOOGLE_SERVICE_ACCOUNT_KEY so a newline-containing PEM never has
// to be quoted in Vercel's env editor.

const READONLY_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

// Only these MIME types get ingested. Everything else is skipped
// (and never dequeued, so if we later add support the file will
// still be found by the cursor).
export const SUPPORTED_MIMES = new Set<string>([
  "application/vnd.google-apps.document", // Google Doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "text/vtt",
  "text/plain",
]);

let cachedClient: drive_v3.Drive | null = null;

function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL is not set. Provision the service account and share the folder with this address before connecting."
    );
  }
  return email;
}

function getServiceAccountKey(): { client_email: string; private_key: string } {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!encoded) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY is not set. Paste the base64-encoded JSON key into the env."
    );
  }
  let json: string;
  try {
    json = Buffer.from(encoded, "base64").toString("utf8");
  } catch (_err) {
    void _err;
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY isn't valid base64.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (_err) {
    void _err;
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY decoded but isn't JSON — check the base64 encoding of the whole key file."
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { client_email?: unknown }).client_email !== "string" ||
    typeof (parsed as { private_key?: unknown }).private_key !== "string"
  ) {
    throw new Error("Service-account key is missing client_email or private_key.");
  }
  return parsed as { client_email: string; private_key: string };
}

function driveClient(): drive_v3.Drive {
  if (cachedClient) return cachedClient;
  const creds = getServiceAccountKey();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: READONLY_SCOPES,
  });
  cachedClient = google.drive({ version: "v3", auth });
  return cachedClient;
}

// Parses a folder id from a raw Drive URL or from the id itself. The
// setup form accepts either — folder URLs are what users copy from
// the address bar; ids come from the "share" dialog.
export function parseGoogleFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Bare id — Drive ids are alphanumeric + a small set of symbols.
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  // URL forms: /folders/<id> and /drive/folders/<id>
  const foldersMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]{20,})/);
  if (foldersMatch) return foldersMatch[1];
  // ?id=<id> query form (older links)
  const idParam = trimmed.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (idParam) return idParam[1];
  return null;
}

async function verifyFolderAccess(
  folderId: string
): Promise<{ folderName: string }> {
  const drive = driveClient();
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
    // Drive returns 404 for both "not found" and "not shared" — the
    // service account can't distinguish. Surface the actionable
    // message so the user knows to share.
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|404/i.test(msg)) {
      throw new Error(
        `The service account can't reach that folder. Share it with ${getServiceAccountEmail()} as Viewer and try again.`
      );
    }
    throw new Error(`Couldn't verify the folder: ${msg}`);
  }
}

async function listNewFiles(source: TranscriptSource): Promise<{
  files: ListedFile[];
  nextCursor: string | null;
}> {
  const drive = driveClient();

  // The cursor is the most recent modifiedTime we've seen. Drive's
  // files.list supports > and >= comparisons in the q param, so we
  // ask for strictly newer to avoid re-ingesting the same file each
  // pass. First run: no cursor, take everything in the folder.
  const parts: string[] = [
    `'${source.folder_id}' in parents`,
    "trashed = false",
    "mimeType != 'application/vnd.google-apps.folder'",
  ];
  if (source.cursor) {
    parts.push(`modifiedTime > '${source.cursor}'`);
  }
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
  void source;
  const drive = driveClient();

  const meta = await drive.files.get({
    fileId,
    fields: "id, name, mimeType",
    supportsAllDrives: true,
  });
  const mimeType = meta.data.mimeType ?? "application/octet-stream";
  const name = meta.data.name ?? fileId;

  // Google Docs need export — you can't just download the raw file.
  // For text/plain, .docx, and .vtt, alt=media returns bytes.
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
