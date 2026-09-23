import type { ClassroomVideoProvider } from "@/lib/classroom/types";
import {
  resolveVideoThumbnail,
  shareUrlFor,
} from "@/lib/classroom/video-thumbnail";
import { VideoEmbedPlayer } from "./VideoEmbedPlayer";

// A video node, with its poster resolved if the node has not got one.
//
// ---- WHY THIS EXISTS RATHER THAN JUST FIXING THE INSERT --------
//
// Storing the poster at insert time fixes videos added from now on.
// It does nothing for one already in a training, and no migration
// can help: the answer lives at Vimeo, not in anything we hold.
//
// The alternative was telling the author to remove and re-add every
// affected video. That is a chore we would be handing out because
// our first version did not ask the right question, on content that
// looks fine until somebody opens the lesson.
//
// So the renderer asks. Only when the node has no poster, only for
// Vimeo — YouTube's derived URL is reliable — and behind a 24 hour
// revalidate, so a lesson page costs at most one request a day per
// video across every reader.
//
// An async Server Component, which is why this is its own file: the
// walker in Renderer.tsx is a plain function and cannot await.
export async function ResolvedVideoEmbed({
  provider,
  videoId,
  videoHash,
  storedThumbnail,
  caption,
}: {
  provider: ClassroomVideoProvider;
  videoId: string;
  videoHash?: string | null;
  storedThumbnail?: string | null;
  caption: string | null;
}) {
  let poster = storedThumbnail ?? null;

  if (!poster && provider === "vimeo") {
    const share = shareUrlFor(provider, videoId, videoHash);
    if (share) poster = await resolveVideoThumbnail(share);
  }

  return (
    <VideoEmbedPlayer
      provider={provider}
      videoId={videoId}
      videoHash={videoHash}
      thumbnailUrl={poster}
      caption={caption}
    />
  );
}
