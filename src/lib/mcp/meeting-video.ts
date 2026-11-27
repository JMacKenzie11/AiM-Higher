import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { parseVimeoUrl, vimeoEmbedUrl } from "@/lib/recap-video/vimeo";
import { AddRefused } from "./adds";
import type { VisibleCompany } from "./company";
import { ReadFailed } from "./reads";

// SET A TEAM MEETING'S SCORE VIDEO (0331). Jason, 2026-11-27: when a
// team meeting has been scored with the facilitation rubric, the meeting
// ready webhook carries the score to a Grok Bot, which builds a short
// 9:16 video going over it, posts it to Vimeo, and hands the link back
// here, signed in as an admin. The newest link for a meeting is the one
// its page shows.
//
// Through assistant_set_meeting_score_video() on the assistant's token,
// as the person. The function decides who may (a system admin, the
// company's company admin, or a content admin for it), checks the link
// and that the meeting is one of the company's team meetings. The table
// stays closed to an AI app (0270).

type Ctx = { db: SupabaseClient; company: VisibleCompany };

export async function setMeetingScoreVideo(
  { db, company }: Ctx,
  args: { meeting_id: string; video_url: string },
  origin: string
): Promise<Record<string, unknown>> {
  const video = parseVimeoUrl(args.video_url);
  if (!video) {
    throw new AddRefused(
      "That isn't a Vimeo video link. Use the video's Vimeo link, such as https://vimeo.com/123456789.",
      "bad_url"
    );
  }
  const { data, error } = await db.rpc("assistant_set_meeting_score_video", {
    p_company_id: company.id,
    p_meeting_id: args.meeting_id,
    p_video_url: args.video_url.trim(),
  });
  if (error) {
    if (error.code === "42501") {
      throw new AddRefused(`Only a system admin or an admin of ${company.name} can set a meeting's score video.`, "not_admin");
    }
    if (error.code === "22023") {
      throw new AddRefused(
        (error.message ?? "").includes("meeting")
          ? `That meeting isn't one of ${company.name}'s team meetings. list_meetings gives the ids.`
          : "That isn't a Vimeo video link. Use the video's Vimeo link, such as https://vimeo.com/123456789.",
        "bad_input"
      );
    }
    // 0331 not applied to this instance yet: the function is missing.
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new AddRefused("Meeting score videos aren't switched on for this AiMS instance yet.", "not_available");
    }
    throw new ReadFailed(error.code ?? "unknown");
  }
  const row = data as { id: string; meeting_id: string; vimeo_id: string; vimeo_hash: string | null; created_at: string };
  revalidatePath(`/leadership/meetings/${row.meeting_id}`);
  return {
    saved: true,
    company: company.name,
    company_id: company.id,
    meeting_id: row.meeting_id,
    video_id: row.vimeo_id,
    saved_at: row.created_at,
    embed_url: vimeoEmbedUrl({ id: row.vimeo_id, hash: row.vimeo_hash }),
    shows_on: `${origin}/leadership/meetings/${row.meeting_id}`,
  };
}
