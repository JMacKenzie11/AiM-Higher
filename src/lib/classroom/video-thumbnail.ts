import "server-only";

import { parseVideoUrl } from "./video-url";

// Ask the provider for a video's poster image.
//
// ---- WHY THIS EXISTS -------------------------------------------
//
// The thumbnail for an UNLISTED Vimeo video cannot be derived from
// its id. vumbnail.com, which the editor used, returns a grey
// placeholder for one — verified by md5: the plain and the
// hash-suffixed URLs return byte-identical bytes.
//
// Vimeo's own oEmbed does know, but only with the privacy hash, and
// it answers with a CDN URL carrying a content digest that cannot be
// constructed from anything we hold. So it has to be asked, once, at
// insert time, and the answer stored on the node.
//
// ---- WHY SERVER-SIDE -------------------------------------------
//
// The editor runs in a browser and this is a cross-origin GET to a
// third party. Doing it here keeps it out of CORS' hands and means a
// provider that starts refusing browser origins does not silently
// stop producing thumbnails.
//
// Failure is not an error. A null answer falls back to the derived
// URL, which is what every existing node already uses, so a slow or
// down oEmbed costs a nicer thumbnail rather than the insert.
//
// ---- AND IT RUNS AT RENDER TIME TOO ----------------------------
//
// Not only at insert. A node stored before this change carries no
// poster, and there is no migration that could add one: the answer
// lives at Vimeo. So the renderer asks for anything it is missing,
// which fixes existing trainings without anybody re-adding a video.
// The 24 hour revalidate means a lesson page pays for this once a
// day at most, per video, across every reader.

export async function resolveVideoThumbnail(
  url: string
): Promise<string | null> {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;
  // YouTube's derived URL is reliable and needs no round trip.
  if (parsed.provider !== "vimeo") return null;

  try {
    const oembed = new URL("https://vimeo.com/api/oembed.json");
    oembed.searchParams.set("url", url);
    // ASK FOR A BIG ONE.
    //
    // oEmbed's default poster is 295x166. Stretched across a lesson
    // page it is visibly soft, which is what shipped the first time:
    // the poster was correct and looked broken. `width` is what
    // moves it — `thumbnail_width` is accepted and ignored, measured
    // against this video:
    //
    //   default            295x166   -d_295x166    6,949 bytes
    //   &width=1280       1280x720   -d_1280      43,333 bytes
    //   &thumbnail_width  295x166    (no change)
    //
    // 1280 rather than larger because the frame is ~1400px at its
    // widest and this is a placeholder somebody looks at for a
    // second before pressing play.
    oembed.searchParams.set("width", "1280");
    const res = await fetch(oembed, {
      // The poster for a given video does not change, and a training
      // is edited rarely. A day is generous and keeps a burst of
      // inserts to one request.
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { thumbnail_url?: unknown };
    const thumb = data.thumbnail_url;
    if (typeof thumb !== "string") return null;
    // Only ever a Vimeo CDN URL. This value is written into a node
    // and rendered as an <img src>, so it does not get to be
    // whatever a redirected response says it is.
    const parsedThumb = new URL(thumb);
    if (!parsedThumb.hostname.endsWith(".vimeocdn.com")) return null;
    return parsedThumb.toString();
  } catch {
    return null;
  }
}

// Rebuild a share URL from what a node stores, so the renderer can
// ask about a video it only has an id for.
export function shareUrlFor(
  provider: string,
  videoId: string,
  hash?: string | null
): string | null {
  if (provider !== "vimeo") return null;
  return hash
    ? `https://vimeo.com/${videoId}/${hash}`
    : `https://vimeo.com/${videoId}`;
}
