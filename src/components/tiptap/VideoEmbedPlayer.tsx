"use client";

import { useState } from "react";
import type { ClassroomVideoProvider } from "@/lib/classroom/types";
import { embedUrl, thumbnailUrl } from "@/lib/classroom/video-url";
import styles from "./VideoEmbedPlayer.module.css";

// Click-to-play video renderer. Mounted server-side inside the
// classroom body via BodyHydrator (which walks the Tiptap JSON
// and inserts one of these wherever it finds a videoEmbed node).
// Renders as a thumbnail with a play overlay; on click, swaps in
// the provider's embed iframe. Deferring the iframe until click
// keeps a page with 10 videos from spinning up 10 iframes at once
// and keeps the initial payload light.

export function VideoEmbedPlayer({
  provider,
  videoId,
  caption,
}: {
  provider: ClassroomVideoProvider;
  videoId: string;
  caption?: string | null;
}) {
  const [playing, setPlaying] = useState(false);
  const label = caption ?? "Play video";

  return (
    <figure className={styles.figure}>
      <div className={styles.frame}>
        {playing ? (
          <iframe
            className={styles.iframe}
            src={embedUrl(provider, videoId)}
            title={label}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className={styles.playButton}
            onClick={() => setPlaying(true)}
            aria-label={label}
            style={{
              backgroundImage: `url("${thumbnailUrl(provider, videoId)}")`,
            }}
          >
            <span className={styles.playCircle} aria-hidden="true">
              <svg viewBox="0 0 24 24" width={28} height={28} fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}
      </div>
      {caption ? (
        <figcaption className={styles.caption}>{caption}</figcaption>
      ) : null}
    </figure>
  );
}
