import "server-only";

// Parse a YouTube or Vimeo share URL into { provider, id } and,
// where cheap, derive the thumbnail URL at save time so the consumer
// pages never have to hit provider APIs at render.
//
// YouTube: the public img.youtube.com/vi/<id>/maxresdefault.jpg URL
// works without an API call, so we compute the thumbnail synchronously.
// Vimeo: no equivalent public path, so we hit oEmbed once at save time
// and cache thumbnail_url on the training row.

export type VideoProvider = "youtube" | "vimeo";

export type ParsedVideo = {
  provider: VideoProvider;
  id: string;
};

export function parseVideoUrl(input: string): ParsedVideo | null {
  const url = input.trim();
  if (!url) return null;

  // YouTube — cover common share/watch/short/embed forms.
  const yt =
    url.match(
      /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/
    );
  if (yt) return { provider: "youtube", id: yt[1] };

  // Vimeo — standard vimeo.com/<id> plus player.vimeo.com and
  // vimeo.com/channels/<name>/<id>. IDs are numeric.
  const vimeo =
    url.match(
      /(?:vimeo\.com\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/|showcase\/[^/]+\/video\/|video\/)?|player\.vimeo\.com\/video\/)(\d{6,})/
    );
  if (vimeo) return { provider: "vimeo", id: vimeo[1] };

  return null;
}

export function embedUrl(parsed: ParsedVideo): string {
  if (parsed.provider === "youtube") {
    return `https://www.youtube.com/embed/${parsed.id}`;
  }
  return `https://player.vimeo.com/video/${parsed.id}`;
}

// Best-effort thumbnail URL. Returns null when no candidate is
// derivable; the training row keeps thumbnail_url null and the UI
// falls back to a placeholder.
export async function resolveThumbnail(
  parsed: ParsedVideo
): Promise<string | null> {
  if (parsed.provider === "youtube") {
    // maxresdefault isn't always populated for older/small videos.
    // We use it optimistically and let the <img> onError fall back
    // to hqdefault in the consumer component if needed.
    return `https://img.youtube.com/vi/${parsed.id}/maxresdefault.jpg`;
  }

  try {
    const res = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
        `https://vimeo.com/${parsed.id}`
      )}`,
      {
        // oEmbed is public but we still want a sensible timeout.
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      thumbnail_url?: string;
      thumbnail_url_with_play_button?: string;
    };
    return data.thumbnail_url ?? null;
  } catch {
    return null;
  }
}

// Convenience: parse + resolve in one call, for use inside a server
// action that's saving a training row.
export async function parseAndResolve(input: string): Promise<
  | { ok: true; provider: VideoProvider; id: string; url: string; thumbnail: string | null }
  | { ok: false }
> {
  const parsed = parseVideoUrl(input);
  if (!parsed) return { ok: false };
  const thumbnail = await resolveThumbnail(parsed);
  return {
    ok: true,
    provider: parsed.provider,
    id: parsed.id,
    url: input.trim(),
    thumbnail,
  };
}
