import "server-only";

import type { TranscriptProvider } from "../provider";

/*
 * Microsoft Teams / SharePoint transcript provider — STUB.
 *
 * Every method throws a descriptive not-configured error. Wiring
 * this for real requires:
 *
 *   1. An Azure app registration in the customer's tenant (or a
 *      multi-tenant app registered in Entra ID).
 *   2. Application permission `Files.Read.All` on Microsoft Graph.
 *      This is an admin-consent-required permission — the tenant
 *      admin must grant it explicitly.
 *   3. A client secret (or a certificate) stored server-side. Never
 *      ship in the client bundle.
 *   4. Per-tenant setup: a stored tenantId per source so token
 *      acquisition targets the right authority.
 *   5. Cursor-based listing via Graph delta queries. Teams
 *      recordings and transcripts live under
 *      /me/drive/items/{itemId}/delta once the folder is known.
 *      Delta returns a nextLink for pagination and a deltaLink to
 *      persist as the source cursor.
 *   6. Extraction reuses the same mammoth / vtt / txt pipeline —
 *      Graph downloads the raw file via /content.
 *
 * We deliberately do not import @microsoft/microsoft-graph-client
 * here so the Google-only build doesn't pull in Azure dependencies.
 * When implementing this, add that import inline and mirror the
 * shape of google-drive.ts.
 */

const NOT_CONFIGURED =
  "Microsoft Teams transcript ingestion isn't set up yet. It requires an Azure app registration with Files.Read.All application permission and per-tenant admin consent — contact the platform team to enable it.";

export const teamsProvider: TranscriptProvider = {
  async listNewFiles() {
    throw new Error(NOT_CONFIGURED);
  },
  async downloadFile() {
    throw new Error(NOT_CONFIGURED);
  },
  async verifyFolderAccess() {
    throw new Error(NOT_CONFIGURED);
  },
};
