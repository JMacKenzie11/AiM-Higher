"use client";

import { useEffect, useRef, useState } from "react";
import type VimeoPlayer from "@vimeo/player";
import styles from "./welcome.module.css";

// How close to the end the player stops and goes back to the start.
// Vimeo puts up its "More from" end screen the moment a video ends, and
// a jump back made after that shows it for half a second. Stopping just
// before the end never shows it. Vimeo reports the time about four
// times a second, so this has to be wider than one report.
const STOP_BEFORE_END_S = 0.5;

// The weekly recap video. When it finishes it goes back to the start
// and waits there, rather than showing Vimeo's "More from" end screen
// (Jason, 2026-11-23). It does not loop: the viewer presses play to
// watch again.
//
// THE COVER (Jason, 2026-11-23). Back at the start, the player shows
// the video's first frame, which for a recap is black. So the video's
// own cover image (`poster`, from Vimeo's oEmbed: what the player shows
// before anyone presses play) goes over it with a play mark, and comes
// off the moment the video plays again. With no cover, the mark sits on
// the tile's own dark background. Reloading the player would bring
// Vimeo's own cover back, but Vimeo's bot check refused the reload in
// testing.
//
// THE COVER IS A PICTURE, NOT A BUTTON. Clicks go through it to the
// player underneath, which starts the video itself. A button of ours
// would have to start it through the player script, and a browser lets
// a video start with sound only from a click inside its own frame; a
// click on our page is not one. Keyboard users reach the player's own
// controls, as before.
//
// The player script loads only once the video is on the page, so the
// rest of the Scoreboard never waits for it.
export function RecapPlayer({ src, poster }: { src: string; poster: string | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const player = useRef<VimeoPlayer | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    let cancelled = false;
    let rewinding = false;

    const rewind = () => {
      const p = player.current;
      if (!p || rewinding) return;
      rewinding = true;
      setFinished(true);
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
      const p = new Player(iframe);
      player.current = p;
      p.on("timeupdate", ({ seconds, duration }: { seconds: number; duration: number }) => {
        if (duration > 0 && duration - seconds <= STOP_BEFORE_END_S) rewind();
      });
      // Seeking straight to the very end can skip the last time report.
      p.on("ended", rewind);
      p.on("play", () => setFinished(false));
    });
    return () => {
      cancelled = true;
      player.current?.off("timeupdate");
      player.current?.off("ended");
      player.current?.off("play");
      player.current = null;
    };
  }, [src]);

  return (
    <>
      <iframe
        ref={frame}
        src={src}
        title="Weekly recap video"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
        allowFullScreen
        loading="lazy"
      />
      {finished ? (
        <div
          className={styles.replay}
          style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
          aria-hidden="true"
        >
          <span className={styles.replayCircle}>
            <svg viewBox="0 0 24 24" width={28} height={28} fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </div>
      ) : null}
    </>
  );
}
