import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { parseVimeoUrl, vimeoEmbedUrl } from "@/lib/recap-video/vimeo";
import { AddRefused } from "./adds";
import type { VisibleCompany } from "./company";
import { ReadFailed } from "./reads";

// SET A COMPANY'S RECAP VIDEO (0328). Jason, 2026-11-20: when a team
// meeting's analysis is ready, a Grok Bot builds a 9:16 recap video,
// posts it to Vimeo, and hands the link back here, signed in as an
// admin. It names the company; the newest link is what the Dashboard's This week tab shows.
//
// Through assistant_set_recap_video() on the assistant's token, as the
// person. The function decides who may (a system admin, the company's
// company admin, or a content admin for it) and checks the link again;
// the table stays closed to an AI app (0270).

type Ctx = { db: SupabaseClient; company: VisibleCompany };

export async function setRecapVideo(
  { db, company }: Ctx,
  args: { video_url: string; meeting_id?: string },
  origin: string
): Promise<Record<string, unknown>> {
  const video = parseVimeoUrl(args.video_url);
  if (!video) {
    throw new AddRefused(
      "That isn't a Vimeo video link. Use the video's Vimeo link, such as https://vimeo.com/123456789.",
      "bad_url"
    );
  }
  const { data, error } = await db.rpc("assistant_set_recap_video", {
    p_company_id: company.id,
    p_video_url: args.video_url.trim(),
    p_meeting_id: args.meeting_id ?? null,
  });
  if (error) {
    if (error.code === "42501") {
      throw new AddRefused(`Only a system admin or an admin of ${company.name} can set its recap video.`, "not_admin");
    }
    if (error.code === "22023") {
      throw new AddRefused(
        (error.message ?? "").includes("meeting")
          ? `That meeting isn't one of ${company.name}'s team meetings. list_meetings gives the ids.`
          : "That isn't a Vimeo video link. Use the video's Vimeo link, such as https://vimeo.com/123456789.",
        "bad_input"
      );
    }
    throw new ReadFailed(error.code ?? "unknown");
  }
  const row = data as { id: string; vimeo_id: string; vimeo_hash: string | null; meeting_id: string | null; created_at: string };
  revalidatePath("/dashboard");
  return {
    saved: true,
    company: company.name,
    company_id: company.id,
    video_id: row.vimeo_id,
    meeting_id: row.meeting_id,
    saved_at: row.created_at,
    embed_url: vimeoEmbedUrl({ id: row.vimeo_id, hash: row.vimeo_hash }),
    shows_on: `${origin}/dashboard`,
  };
}
