import "server-only";

// The transcript-source abstraction. Every provider (Google Drive
// today, Microsoft Teams later) implements this interface so the
// cron + analysis pipeline stays provider-agnostic. Adding a
// provider is: (1) implement TranscriptProvider, (2) add the
// provider tag to the provider enum in the DB migration, and
// (3) wire the tag → implementation in getProvider().

import type { TranscriptSource, TranscriptProviderKind } from "@/lib/types";

export type ListedFile = {
  fileId: string;
  name: string;
  modifiedAt: string; // ISO — used to advance the source cursor
};

export type DownloadedFile = {
  buffer: Buffer;
  mimeType: string;
  name: string;
};

export interface TranscriptProvider {
  // List files in the folder modified since the source's cursor.
  // Providers own their own pagination; callers pass the cursor
  // opaquely and receive it back to advance.
  listNewFiles(source: TranscriptSource): Promise<{
    files: ListedFile[];
    nextCursor: string | null;
  }>;

  downloadFile(source: TranscriptSource, fileId: string): Promise<DownloadedFile>;

  // Called during the connect flow — verifies the company's OAuth
  // account can actually read the folder. Returns the folder's
  // display name for storage. Throws with a friendly message when
  // the folder isn't shared or the id is malformed.
  verifyFolderAccess(
    folderId: string,
    companyId: string
  ): Promise<{ folderName: string }>;
}

// Provider registry. Each tag maps to the module that owns its
// implementation — lazy imports keep the Teams stub's Azure SDK
// requirements from tree-shaking into the Google-only build.
export async function getProvider(
  kind: TranscriptProviderKind
): Promise<TranscriptProvider> {
  if (kind === "google_drive") {
    const mod = await import("./providers/google-drive");
    return mod.googleDriveProvider;
  }
  if (kind === "teams") {
    const mod = await import("./providers/teams");
    return mod.teamsProvider;
  }
  throw new Error(`Unknown transcript provider: ${kind}`);
}
