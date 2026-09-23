"use server";

import { resolveVideoThumbnail } from "./video-thumbnail";

// The editor is a client component, so it cannot call the plain
// server function. This is the one-line door for it; the renderer
// calls resolveVideoThumbnail directly.
export async function resolveVideoThumbnailAction(
  url: string
): Promise<string | null> {
  return resolveVideoThumbnail(url);
}
