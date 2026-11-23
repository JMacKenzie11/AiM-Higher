"use client";

import { useEffect, useRef } from "react";

// How close to the end the player stops and goes back to the start.
// Vimeo puts up its "More from" end screen the moment a video ends, and
// a jump back made after that shows it for half a second. Stopping just
// before the end never shows it. Vimeo reports the time about four
// times a second, so this has to be wider than one report.
const STOP_BEFORE_END_S = 0.5;

// The weekly recap video. When it finishes it goes back to the start
// and waits there, rather than showing Vimeo's "More from" end screen
// (Jason, 2026-11-23). It does not loop: the viewer presses play to
// watch again. The player script loads only once the video is on the
// page, so the rest of the Scoreboard never waits for it.
export function RecapPlayer({ src }: { src: string }) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    let cancelled = false;
    let player: import("@vimeo/player").default | null = null;
    let rewinding = false;

    const rewind = () => {
      if (!player || rewinding) return;
      rewinding = true;
      const p = player;
      void p
        .pause()
        .then(() => p.setCurrentTime(0))
        .catch(() => {})
        .finally(() => {
          rewinding = false;
        });
    };

    void import("@vimeo/player").then(({ default: Player }) => {
      if (cancelled) return;
      player = new Player(iframe);
      player.on("timeupdate", ({ seconds, duration }: { seconds: number; duration: number }) => {
        if (duration > 0 && duration - seconds <= STOP_BEFORE_END_S) rewind();
      });
      // Seeking straight to the very end can skip the last time report.
      player.on("ended", rewind);
    });
    return () => {
      cancelled = true;
      player?.off("timeupdate");
      player?.off("ended");
    };
  }, [src]);

  return (
    <iframe
      ref={frame}
      src={src}
      title="Weekly recap video"
      allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
      allowFullScreen
      loading="lazy"
    />
  );
}
