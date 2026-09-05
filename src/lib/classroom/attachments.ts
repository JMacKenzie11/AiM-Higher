import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ClassroomAttachment } from "./types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Sign short-lived download URLs for classroom attachments. Called
// server-side from the training viewer so an expired URL doesn't
// need to be handled on the client. The RLS on classroom_attachments
// gates whether the caller can even see the row; the storage policy
// mirrors it as defence-in-depth.

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — plenty for a
// training viewing session; short enough that leaked URLs die.

export async function signAttachmentUrls(
  attachments: readonly ClassroomAttachment[]
): Promise<Array<ClassroomAttachment & { download_url: string | null }>> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const results = await Promise.all(
    attachments.map(async (att) => {
      const { data } = await supabase.storage
        .from("classroom-attachments")
        .createSignedUrl(att.storage_path, SIGNED_URL_TTL_SECONDS, {
          download: att.file_name,
        });
      return { ...att, download_url: data?.signedUrl ?? null };
    })
  );
  return results;
}
