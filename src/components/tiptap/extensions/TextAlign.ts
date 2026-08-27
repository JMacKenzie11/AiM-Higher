import { Extension } from "@tiptap/core";

// Adds a textAlign attribute to paragraph and heading nodes. Kept as
// an in-repo extension rather than pulling in @tiptap/extension-text-
// align because the Vercel build is memory-tight — the extra dep isn't
// worth the risk when the whole thing is ~30 lines.
//
// Values: "left" | "center" | "right". Renders as inline style so the
// JSON walker on the reader side just reflects node.attrs.textAlign
// into a style prop.

type Align = "left" | "center" | "right";

const ALIGN_VALUES: readonly Align[] = ["left", "center", "right"] as const;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textAlign: {
      setTextAlign: (align: Align) => ReturnType;
      unsetTextAlign: () => ReturnType;
    };
  }
}

export const TextAlign = Extension.create({
  name: "textAlign",

  addOptions() {
    return {
      types: ["paragraph", "heading"] as string[],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: null as Align | null,
            parseHTML: (el) => {
              const raw = (el as HTMLElement).style.textAlign;
              return ALIGN_VALUES.includes(raw as Align) ? (raw as Align) : null;
            },
            renderHTML: (attrs) =>
              attrs.textAlign
                ? { style: `text-align: ${attrs.textAlign};` }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextAlign:
        (align: Align) =>
        ({ commands }) => {
          if (!ALIGN_VALUES.includes(align)) return false;
          return this.options.types
            .map((type: string) => commands.updateAttributes(type, { textAlign: align }))
            .some(Boolean);
        },
      unsetTextAlign:
        () =>
        ({ commands }) => {
          return this.options.types
            .map((type: string) => commands.resetAttributes(type, "textAlign"))
            .some(Boolean);
        },
    };
  },
});
