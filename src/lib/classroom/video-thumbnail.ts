"use server";

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

export async function resolveVideoThumbnailAction(
  url: string
): Promise<string | null> {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;
  // YouTube's derived URL is reliable and needs no round trip.
  if (parsed.provider !== "vimeo") return null;

  try {
    const oembed = new URL("https://vimeo.com/api/oembed.json");
    oembed.searchParams.set("url", url);
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
