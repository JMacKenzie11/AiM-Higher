// Client-safe URL parser for the classroom videoEmbed Tiptap node.
// Ported from the pre-0145 src/lib/classroom/video.ts (which was
// server-only + also derived thumbnails synchronously) — this one
// stays intentionally simple: URL in, {provider, id} out. Thumbnail
// derivation lives in thumbnailUrl() so the editor + viewer share
// one source of truth.
//
// No "server-only" import — this module runs on both sides: the
// admin editor uses it in a browser event handler (paste-detect,
// insert-Vimeo button), and the server renderer uses it to
// validate node attrs before generating HTML.

import type { ClassroomVideoProvider } from "./types";

export type ParsedVideoUrl = {
  provider: ClassroomVideoProvider;
  id: string;
};

// Parse a YouTube or Vimeo share URL into { provider, id }.
// Returns null when the input doesn't match a known shape rather
// than throwing — the editor uses the null path to fall back to
// keeping the pasted URL as plain text.
export function parseVideoUrl(input: string): ParsedVideoUrl | null {
  const url = input.trim();
  if (!url) return null;

  // YouTube: cover standard watch, embed, short, live, and the
  // youtu.be shortlink. Video ids are 11 chars in practice but the
  // pattern accepts 6-15 to future-proof.
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/
  );
  if (yt) return { provider: "youtube", id: yt[1]! };

  // Vimeo: covers standard vimeo.com/<id>, player.vimeo.com, and
  // the /video/ prefix form. Excludes /channels/ etc. since those
  // aren't video ids on their own.
  const vimeo = url.match(
    /(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d{6,15})/
  );
  if (vimeo) return { provider: "vimeo", id: vimeo[1]! };

  return null;
}

// Thumbnail URL for a parsed video. Both providers expose a
// public thumbnail service that doesn't need an API call:
//   YouTube: img.youtube.com/vi/<id>/hqdefault.jpg
//   Vimeo:   vumbnail.com/<id>.jpg (community mirror of Vimeo's
//            oEmbed thumbnails; no auth, ~200ms typical latency)
export function thumbnailUrl(
  provider: ClassroomVideoProvider,
  videoId: string
): string {
  if (provider === "youtube") {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }
  return `https://vumbnail.com/${videoId}.jpg`;
}

// Embed URL that the click-to-play swap-in should load.
export function embedUrl(
  provider: ClassroomVideoProvider,
  videoId: string
): string {
  if (provider === "youtube") {
    // rel=0 keeps YouTube's post-play recommendations tied to the
    // creator's own channel; modestbranding drops the giant logo.
    return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&autoplay=1`;
  }
  return `https://player.vimeo.com/video/${videoId}?autoplay=1`;
}
