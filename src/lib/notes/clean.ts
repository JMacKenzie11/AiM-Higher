// NOTES: what a saved note may contain, and its plain text.
//
// Notes on an issue or a commitment (0287) are a TipTap document,
// stored as JSON and never as HTML. Every document is cleaned here
// before it is saved, whatever sent it: the editor, a paste, or a
// hand-made request. What survives is the five kinds of formatting
// the editor offers and nothing else:
//
//   paragraph, bulletList, orderedList, listItem, hardBreak, text
//   marks: bold, italic, link (http, https or mailto only)
//
// Anything else is unwrapped to its text or dropped. NotesView draws
// the result as React elements, so nothing stored reaches the page as
// markup, and a link that is not a web or email address never becomes
// a link at all.

export type NotesMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "link"; attrs: { href: string } };

export type NotesNode = {
  type: "doc" | "paragraph" | "bulletList" | "orderedList" | "listItem" | "hardBreak" | "text";
  text?: string;
  marks?: NotesMark[];
  attrs?: { start?: number };
  content?: NotesNode[];
};

export type NotesDoc = NotesNode & { type: "doc" };

// The column allows 100,000 bytes (0287). The text limit sits well
// under it so the formatting around the text always fits too.
export const NOTES_MAX_CHARS = 20000;

const BLOCKS = new Set(["paragraph", "bulletList", "orderedList"]);

type Raw = { type?: unknown; text?: unknown; marks?: unknown; attrs?: unknown; content?: unknown };

export function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  if (!href || href.length > 2000) return null;
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function cleanMarks(raw: unknown): NotesMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NotesMark[] = [];
  for (const m of raw as Raw[]) {
    if (!m || typeof m !== "object") continue;
    if (m.type === "bold" && !out.some((x) => x.type === "bold")) out.push({ type: "bold" });
    else if (m.type === "italic" && !out.some((x) => x.type === "italic")) out.push({ type: "italic" });
    else if (m.type === "link" && !out.some((x) => x.type === "link")) {
      const href = safeHref((m.attrs as { href?: unknown } | undefined)?.href);
      if (href) out.push({ type: "link", attrs: { href } });
    }
  }
  return out.length ? out : undefined;
}

// Inline content: text and hard breaks. Anything else inline (an image,
// a mention) is dropped; a block found inline gives up its text.
function cleanInline(raw: unknown): NotesNode[] {
  if (!Array.isArray(raw)) return [];
  const out: NotesNode[] = [];
  for (const n of raw as Raw[]) {
    if (!n || typeof n !== "object") continue;
    if (n.type === "text" && typeof n.text === "string" && n.text.length > 0) {
      const marks = cleanMarks(n.marks);
      out.push(marks ? { type: "text", text: n.text, marks } : { type: "text", text: n.text });
    } else if (n.type === "hardBreak") {
      out.push({ type: "hardBreak" });
    } else if (Array.isArray(n.content)) {
      out.push(...cleanInline(n.content));
    }
  }
  return out;
}

function cleanListItem(raw: Raw): NotesNode | null {
  const content = cleanBlocks(raw.content);
  if (content.length === 0) return null;
  return { type: "listItem", content };
}

// Block content. A heading, quote or code block becomes a paragraph
// holding its text, so a paste keeps its words and loses the styling.
function cleanBlocks(raw: unknown): NotesNode[] {
  if (!Array.isArray(raw)) return [];
  const out: NotesNode[] = [];
  for (const n of raw as Raw[]) {
    if (!n || typeof n !== "object") continue;
    if (n.type === "bulletList" || n.type === "orderedList") {
      const items = (Array.isArray(n.content) ? (n.content as Raw[]) : [])
        .filter((c) => c && typeof c === "object" && c.type === "listItem")
        .map(cleanListItem)
        .filter((c): c is NotesNode => c !== null);
      if (items.length === 0) continue;
      const node: NotesNode = { type: n.type, content: items };
      if (n.type === "orderedList") {
        const start = Number((n.attrs as { start?: unknown } | undefined)?.start);
        if (Number.isInteger(start) && start > 1 && start < 10000) node.attrs = { start };
      }
      out.push(node);
    } else if (typeof n.type === "string" && (n.type === "paragraph" || !BLOCKS.has(n.type))) {
      if (n.type === "listItem" || n.type === "blockquote" || n.type === "doc") {
        out.push(...cleanBlocks(n.content));
        continue;
      }
      const inline = n.type === "text" || n.type === "hardBreak" ? cleanInline([n]) : cleanInline(n.content);
      if (inline.length) out.push({ type: "paragraph", content: inline });
      else if (n.type === "paragraph") out.push({ type: "paragraph" });
    }
  }
  return out;
}

// A document reduced to what notes may hold, or null when nothing with
// any text is left (an empty note is stored as null, not as an empty
// document, so "has notes" is one test everywhere).
export function cleanNotes(raw: unknown): NotesDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Raw;
  const content = cleanBlocks(r.type === "doc" ? r.content : [r]);
  const doc: NotesDoc = { type: "doc", content };
  return notesText(doc).trim() ? doc : null;
}

// Plain text, one line per paragraph or list item, lists marked with
// "- " or "1. ". What Aimee and AI apps read, and what the row's notes
// icon shows on hover (its first line).
export function notesText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const lines: string[] = [];
  const inline = (nodes: NotesNode[] | undefined): string =>
    (nodes ?? [])
      .map((n) => (n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? "\n" : inline(n.content)))
      .join("");
  const walk = (nodes: NotesNode[] | undefined, prefix: string) => {
    for (const n of nodes ?? []) {
      if (n.type === "paragraph") lines.push(prefix + inline(n.content));
      else if (n.type === "bulletList" || n.type === "orderedList") {
        let i = n.attrs?.start ?? 1;
        for (const item of n.content ?? []) {
          const marker = n.type === "bulletList" ? "- " : `${i++}. `;
          const before = lines.length;
          walk(item.content, "");
          for (let k = before; k < lines.length; k++) {
            lines[k] = (k === before ? prefix + marker : prefix + "   ") + lines[k];
          }
        }
      }
    }
  };
  walk((doc as NotesNode).content, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function notesFirstLine(doc: unknown): string {
  return notesText(doc).split("\n").find((l) => l.trim())?.trim() ?? "";
}

// Notes as Aimee and AI apps read them: plain text, capped so one long
// note cannot crowd everything else out of what they are given. Null
// when there are none, so a reader can leave the field off.
export function notesForReader(doc: unknown, max = 800): string | null {
  const text = notesText(doc);
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
