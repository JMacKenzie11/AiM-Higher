"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { ClassroomVideoProvider } from "@/lib/classroom/types";
import { thumbnailUrl } from "@/lib/classroom/video-url";
import styles from "./VideoEmbedNodeView.module.css";

// In-editor render of the videoEmbed node. Shows the thumbnail
// (from the provider's public thumbnail service) plus a caption
// input the author can fill in. NEVER loads the actual player
// while editing — the user explicitly asked for scrubbing through
// a long section to be cheap, and this is where that promise
// lives.
//
// Consumer pages don't use this component; the JSON walker in
// Renderer.tsx renders VideoEmbedPlayer instead.

export function VideoEmbedNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const provider = node.attrs.provider as ClassroomVideoProvider;
  const videoId = (node.attrs.videoId as string) ?? "";
  const caption = (node.attrs.caption as string | null) ?? "";

  return (
    <NodeViewWrapper
      className={`${styles.wrap} ${selected ? styles.wrapSelected : ""}`}
      data-drag-handle
    >
      <div className={styles.thumbBox}>
        {videoId ? (
          <img
            className={styles.thumb}
            src={thumbnailUrl(provider, videoId)}
            alt=""
            loading="lazy"
          />
        ) : (
          <div className={styles.placeholder}>Missing video id</div>
        )}
        <span className={styles.providerBadge}>
          {provider === "youtube" ? "YouTube" : "Vimeo"}
        </span>
      </div>
      <input
        type="text"
        className={styles.captionInput}
        placeholder="Caption (optional)"
        value={caption}
        onChange={(e) =>
          updateAttributes({ caption: e.target.value || null })
        }
        aria-label="Video caption"
      />
    </NodeViewWrapper>
  );
}
