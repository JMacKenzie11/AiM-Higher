import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { ClassroomVideoProvider } from "@/lib/classroom/types";
import { VideoEmbedNodeView } from "./VideoEmbedNodeView";

// Custom Tiptap node for inline YouTube / Vimeo embeds inside a
// classroom section body. Stored in the JSON as
//   { type: "videoEmbed", attrs: { provider, videoId, caption } }
// Server-side generateHTML emits a data-attribute div that a
// client-side hydrator picks up and swaps for the actual player
// (see VideoEmbedPlayer). Keeping the emitted HTML declarative
// means we never ship the iframe in the initial paint — the
// player only mounts on click.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    videoEmbed: {
      insertVideoEmbed: (attrs: {
        provider: ClassroomVideoProvider;
        videoId: string;
        // Vimeo's privacy hash, for an unlisted video. Without it
        // the player shows Vimeo's "Sorry" screen.
        videoHash?: string | null;
        thumbnailUrl?: string | null;
        caption?: string | null;
      }) => ReturnType;
    };
  }
}

export const VideoEmbed = Node.create({
  name: "videoEmbed",
  // Block-level so it lives between paragraphs like an image
  // rather than mid-sentence.
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      provider: {
        default: "youtube",
        parseHTML: (el) => el.getAttribute("data-provider"),
        renderHTML: (attrs) => ({ "data-provider": attrs.provider }),
      },
      videoId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-video-id"),
        renderHTML: (attrs) =>
          attrs.videoId ? { "data-video-id": attrs.videoId } : {},
      },
      // Vimeo's privacy hash for an unlisted video. Optional, so
      // every node stored before this change parses unchanged: a
      // missing attribute reads as null and the URLs behave exactly
      // as they did.
      videoHash: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-video-hash") || null,
        renderHTML: (attrs) =>
          attrs.videoHash ? { "data-video-hash": attrs.videoHash } : {},
      },
      // The poster resolved from the provider at insert time. The
      // only thing that works for an unlisted Vimeo video; null for
      // everything stored before this, which falls back to the
      // derived URL.
      thumbnailUrl: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-thumbnail-url") || null,
        renderHTML: (attrs) =>
          attrs.thumbnailUrl ? { "data-thumbnail-url": attrs.thumbnailUrl } : {},
      },
      caption: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-caption") || null,
        renderHTML: (attrs) =>
          attrs.caption ? { "data-caption": attrs.caption } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-video-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    // The wrapper is what the server ships; VideoEmbedPlayer looks
    // for this shape on mount and swaps its children for the
    // thumbnail + click-to-play iframe.
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-video-embed": "true",
        class: "aims-video-embed",
      }),
    ];
  },

  addCommands() {
    return {
      insertVideoEmbed:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: {
                provider: attrs.provider,
                videoHash: attrs.videoHash ?? null,
                thumbnailUrl: attrs.thumbnailUrl ?? null,
                videoId: attrs.videoId,
                caption: attrs.caption ?? null,
              },
            })
            .run(),
    };
  },

  // In-editor rendering: mount a React node view so the author
  // sees a real thumbnail + caption input instead of an empty div.
  // Viewer path uses the JSON walker in Renderer.tsx (which
  // outputs VideoEmbedPlayer directly) so nothing here ships to
  // consumers.
  addNodeView() {
    return ReactNodeViewRenderer(VideoEmbedNodeView);
  },
});
