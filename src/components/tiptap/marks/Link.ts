import { Mark, mergeAttributes } from "@tiptap/core";

// Inline link mark for classroom section bodies. Kept as an in-repo
// mark instead of pulling @tiptap/extension-link — same reasoning as
// TextAlign: the Vercel build is memory-tight and this is ~40 lines.
//
// Stored in JSON as a mark on a text node:
//   { type: "text", text: "click me", marks: [{ type: "link",
//     attrs: { href: "https://..." } }] }
//
// Renderer.tsx has a matching case that emits <a href="..."
// target="_blank" rel="noopener noreferrer">.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    link: {
      setLink: (attrs: { href: string }) => ReturnType;
      unsetLink: () => ReturnType;
    };
  }
}

// Only http, https, and mailto are admitted. javascript: URLs are the
// classic XSS vector on a rich text editor; strip anything that isn't
// a safe scheme rather than trying to sanitize it.
const SAFE_SCHEME = /^(https?:|mailto:)/i;

function normalizeHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (SAFE_SCHEME.test(trimmed)) return trimmed;
  // Bare domain like "aims.institute" → prepend https:// so the link
  // resolves at all. Leaves relative paths alone (they start with /).
  if (/^\//.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

export const Link = Mark.create({
  name: "link",
  // Same-priority as the default marks so bold/italic/link nest
  // naturally.
  priority: 1000,
  keepOnSplit: false,
  inclusive: false, // don't extend the link when the user types past its end

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (el) => normalizeHref(el.getAttribute("href")),
        renderHTML: (attrs) =>
          attrs.href
            ? {
                href: attrs.href,
                target: "_blank",
                rel: "noopener noreferrer",
              }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[href]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      // Use `commands.setMark` (not a nested chain) so the mark
      // application composes into the OUTER chain the caller
      // started. Nested chain().run() inside a command handler
      // executes immediately and can race with the outer chain's
      // run — a classic silent-no-op cause.
      setLink:
        (attrs) =>
        ({ commands }) => {
          const href = normalizeHref(attrs.href);
          if (!href) return false;
          return commands.setMark(this.name, { href });
        },
      unsetLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
