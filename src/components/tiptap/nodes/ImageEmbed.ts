import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageEmbedNodeView } from "./ImageEmbedNodeView";

// Inline image node for classroom section bodies. Stored in JSON as
//   { type: "image", attrs: { src, alt, width } }
// width is a percentage of the container (25..100) so images look
// consistent across viewport widths. null width means natural size,
// which we treat as 100% for layout.
//
// The editor renders a NodeView with a corner resize handle; the
// reader path uses the JSON walker in Renderer.tsx which emits a
// plain <img> with an inline width style. No hydration needed.

type ImageAlign = "left" | "center" | "right";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    image: {
      insertImageEmbed: (attrs: {
        src: string;
        alt?: string | null;
        width?: number | null;
        align?: ImageAlign | null;
      }) => ReturnType;
      setImageAlign: (align: ImageAlign) => ReturnType;
    };
  }
}

export const ImageEmbed = Node.create({
  name: "image",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute("src"),
        renderHTML: (attrs) => (attrs.src ? { src: attrs.src } : {}),
      },
      alt: {
        default: null,
        parseHTML: (el) => el.getAttribute("alt") || null,
        renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt } : {}),
      },
      width: {
        // Percentage (25..100). null = full width.
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-width");
          const parsed = raw ? Number(raw) : NaN;
          return Number.isFinite(parsed) ? parsed : null;
        },
        renderHTML: (attrs) =>
          typeof attrs.width === "number"
            ? {
                "data-width": String(attrs.width),
                style: `width: ${attrs.width}%; height: auto;`,
              }
            : {},
      },
      align: {
        default: null as ImageAlign | null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-align");
          return raw === "left" || raw === "center" || raw === "right"
            ? (raw as ImageAlign)
            : null;
        },
        renderHTML: (attrs) =>
          attrs.align ? { "data-align": attrs.align } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },

  addCommands() {
    return {
      insertImageEmbed:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: {
                src: attrs.src,
                alt: attrs.alt ?? null,
                width: attrs.width ?? null,
                align: attrs.align ?? null,
              },
            })
            .run(),
      setImageAlign:
        (align) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { align }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageEmbedNodeView);
  },
});
