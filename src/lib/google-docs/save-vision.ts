import "server-only";

import { Readable } from "node:stream";
import { google } from "googleapis";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import type { VividVisionDoc } from "@/lib/foundation/vivid-vision";
import { authorisedClient } from "./connection";
import { visionDocName, visionHtml } from "./vision-html";

// Save a conversation's Vivid Vision to the person's Google Drive
// (0318). The first save creates a Google Doc; every later save from
// the same conversation replaces that doc's contents, so the link the
// leader shared with their team keeps working. A doc they deleted or
// put in the bin is made again.
//
// The caller has already read the conversation and message as the
// person (RLS is the gate); this only writes to their Drive and
// records which doc it was.

export type SaveVisionResult = { ok: true; url: string; updated: boolean } | { ok: false; connect: true };

const DOC_MIME = "application/vnd.google-apps.document";

export async function saveVisionToGoogleDoc(input: {
  profileId: string;
  conversationId: string;
  origin: string;
  doc: VividVisionDoc;
  companyName: string;
  year: number;
}): Promise<SaveVisionResult> {
  const auth = await authorisedClient(input.profileId, input.origin);
  if (!auth) return { ok: false, connect: true };
  const drive = google.drive({ version: "v3", auth });
  const name = visionDocName(input.companyName, input.year);
  const media = () => ({ mimeType: "text/html", body: Readable.from([visionHtml(input.doc, input.companyName, input.year)]) });

  const db = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: link } = await db
    .from("vivid_vision_google_docs")
    .select("file_id")
    .eq("conversation_id", input.conversationId)
    .eq("profile_id", input.profileId)
    .maybeSingle<{ file_id: string }>();

  if (link?.file_id) {
    const existing = await drive.files
      .get({ fileId: link.file_id, fields: "id, trashed" })
      .then((r) => r.data)
      .catch(() => null);
    if (existing && !existing.trashed) {
      const { data } = await drive.files.update({
        fileId: link.file_id,
        requestBody: { name },
        media: media(),
        fields: "id, webViewLink",
      });
      await db
        .from("vivid_vision_google_docs")
        .update({ updated_at: new Date().toISOString() })
        .eq("conversation_id", input.conversationId)
        .eq("profile_id", input.profileId);
      return { ok: true, url: data.webViewLink ?? `https://docs.google.com/document/d/${link.file_id}/edit`, updated: true };
    }
  }

  const { data } = await drive.files.create({
    requestBody: { name, mimeType: DOC_MIME },
    media: media(),
    fields: "id, webViewLink",
  });
  if (!data.id) throw new Error("Google did not return the new doc.");
  await db
    .from("vivid_vision_google_docs")
    .upsert(
      { conversation_id: input.conversationId, profile_id: input.profileId, file_id: data.id, updated_at: new Date().toISOString() },
      { onConflict: "conversation_id,profile_id" }
    );
  return { ok: true, url: data.webViewLink ?? `https://docs.google.com/document/d/${data.id}/edit`, updated: false };
}
