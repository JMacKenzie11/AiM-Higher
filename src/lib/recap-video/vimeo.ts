// A Vimeo link, read the way assistant_set_recap_video() reads it
// (0328), and the player link /welcome embeds.
//
// The database is the rule; this is the same rule in the app so the
// MCP tool can refuse a bad link in plain words before calling it,
// and so the page builds the player from what was stored.

export type VimeoVideo = { id: string; hash: string | null };

const PAGE = /^https:\/\/(?:www\.)?vimeo\.com\/([0-9]{3,15})(?:\/([0-9a-f]{4,32}))?\/?(?:[?#].*)?$/;
const PLAYER = /^https:\/\/player\.vimeo\.com\/video\/([0-9]{3,15})\/?(?:[?#].*)?$/;
const HASH_PARAM = /[?&]h=([0-9a-f]{4,32})(?:&|#|$)/;

export function parseVimeoUrl(raw: string): VimeoVideo | null {
  const url = raw.trim();
  if (url.length > 500) return null;
  const page = PAGE.exec(url);
  if (page) return { id: page[1], hash: page[2] ?? null };
  const player = PLAYER.exec(url);
  if (player) return { id: player[1], hash: HASH_PARAM.exec(url)?.[1] ?? null };
  return null;
}

// The player with its controls only (Jason, 2026-11-19): no title,
// byline or portrait. dnt keeps Vimeo from tracking the viewer. The
// Vimeo logo and the like and share buttons are settings on the Vimeo
// account, not on the link.
export function vimeoEmbedUrl(video: VimeoVideo): string {
  const params = new URLSearchParams();
  if (video.hash) params.set("h", video.hash);
  params.set("title", "0");
  params.set("byline", "0");
  params.set("portrait", "0");
  params.set("badge", "0");
  params.set("dnt", "1");
  return `https://player.vimeo.com/video/${video.id}?${params.toString()}`;
}
