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
  // Vimeo's PRIVACY HASH, for an unlisted video.
  //
  // An unlisted Vimeo URL is vimeo.com/<id>/<hash>, and the hash is
  // not decoration: without it the player refuses the video and the
  // thumbnail service returns a placeholder. Dropping it is what
  // produced "Sorry. We're having a little trouble." on a link that
  // plays perfectly in a browser.
  //
  // Absent for a public video and for YouTube, which has no
  // equivalent.
  hash?: string;
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
  //
  // The optional trailing group is the privacy hash on an UNLISTED
  // video: vimeo.com/1229485592/75fc612f9a. Ten hex characters in
  // practice; the pattern accepts 6-20 alphanumerics rather than
  // pinning a length Vimeo never documented.
  const vimeo = url.match(
    /(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d{6,15})(?:[/?&]h=|\/)?([A-Za-z0-9]{6,20})?/
  );
  if (vimeo) {
    const hash = vimeo[2];
    return {
      provider: "vimeo",
      id: vimeo[1]!,
      ...(hash ? { hash } : {}),
    };
  }

  return null;
}

// Thumbnail URL for a parsed video. Both providers expose a
// public thumbnail service that doesn't need an API call:
//   YouTube: img.youtube.com/vi/<id>/hqdefault.jpg
//   Vimeo:   vumbnail.com/<id>.jpg (community mirror of Vimeo's
//            oEmbed thumbnails; no auth, ~200ms typical latency)
// Vimeo's oEmbed answers 295x166 unless asked otherwise, and nodes
// stored before we started asking carry that small URL. Stretched to
// the ~1400px lesson frame it is visibly soft.
//
// The size is a suffix on the CDN URL, so it can be rewritten in
// place. The un-constructible part of that URL is the content digest
// before it, which a stored poster already holds. Measured, not
// assumed: rewriting the suffix returns the same bytes as asking
// oEmbed for width=1280 — 1280x720, 43,333 bytes, against the same
// 6,949 byte 295x166 original.
//
// Doing it here rather than in a migration means an existing node is
// fixed on the next render, with no network call and nothing to
// rewrite in the document. Anything that is not a Vimeo CDN poster
// is returned untouched.
const VIMEO_POSTER_SIZE = /^(https:\/\/[^/]*\.vimeocdn\.com\/.*)-d_\d+(?:x\d+)?(\?.*)?$/;

export function upscaleVimeoPoster(url: string): string {
  const match = VIMEO_POSTER_SIZE.exec(url);
  if (!match) return url;
  return `${match[1]}-d_1280${match[2] ?? ""}`;
}

// A poster for a video.
//
// `stored` is the URL resolved from the provider's oEmbed at insert
// time and kept on the node. Preferred whenever present, because it
// is the only thing that works for an UNLISTED Vimeo video: vumbnail
// cannot see one, and returns a grey placeholder. Measured rather
// than assumed — vumbnail.com/<id>.jpg and vumbnail.com/<id>_<hash>.jpg
// return byte-identical placeholders for an unlisted video, same
// md5, so passing the hash to it achieves nothing.
//
// Falls back to the derived URLs for nodes stored before this, which
// is correct for every public video.
export function thumbnailUrl(
  provider: ClassroomVideoProvider,
  videoId: string,
  stored?: string | null
): string {
  if (stored) return upscaleVimeoPoster(stored);
  if (provider === "youtube") {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }
  return `https://vumbnail.com/${videoId}.jpg`;
}

// Embed URL that the click-to-play swap-in should load.
export function embedUrl(
  provider: ClassroomVideoProvider,
  videoId: string,
  hash?: string | null
): string {
  if (provider === "youtube") {
    // rel=0 keeps YouTube's post-play recommendations tied to the
    // creator's own channel; modestbranding drops the giant logo.
    return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&autoplay=1`;
  }
  // h= is REQUIRED for an unlisted video. Vimeo returns its "Sorry"
  // screen without it, which looks like a broken player rather than
  // a missing credential.
  const privacy = hash ? `&h=${hash}` : "";
  return `https://player.vimeo.com/video/${videoId}?autoplay=1${privacy}`;
}
