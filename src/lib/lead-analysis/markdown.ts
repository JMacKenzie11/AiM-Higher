// The analysis markdown, read into blocks the PDF can lay out.
//
// The analyzer writes a fixed, narrow shape (prompts/meeting-analyzer.md):
// ## and ### headings, a bold line as a sub-heading, bullets and
// numbered lists (sometimes nested), paragraphs, **bold** and *italic*.
// This reads that shape and nothing more; anything else becomes a
// paragraph, so nothing the model wrote is lost.

export type Inline = { text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "list"; ordered: boolean; items: { depth: number; inline: Inline[] }[] };

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] ?? m[3]) out.push({ text: (m[2] ?? m[3])!, bold: true });
    else out.push({ text: (m[4] ?? m[5])!, italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter((s) => s.text.length > 0);
}

const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function parseMarkdown(markdown: string): Block[] {
  const text = markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Extract<Block, { type: "list" }> | null = null;

  const flushPara = () => {
    if (para.length > 0) blocks.push({ type: "paragraph", inline: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "" || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) {
      flushPara();
      flushList();
      const level = Math.min(4, Math.max(2, heading[1].length)) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: stripMarks(heading[2]) });
      continue;
    }
    // A line that is bold and nothing else is a sub-heading
    // ("**What Was Discussed**").
    const boldLine = /^\s*\*\*([^*]+)\*\*:?\s*$/.exec(line);
    if (boldLine && !list) {
      flushPara();
      blocks.push({ type: "heading", level: 4, text: boldLine[1].trim() });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      const ordered = /\d/.test(bullet[2]);
      const depth = Math.min(3, Math.floor(bullet[1].replace(/\t/g, "  ").length / 2));
      if (!list || (depth === 0 && list.ordered !== ordered)) {
        flushList();
        list = { type: "list", ordered, items: [] };
      }
      list.items.push({ depth, inline: parseInline(bullet[3]) });
      continue;
    }
    // A continuation line inside a list item joins that item.
    if (list && /^\s+\S/.test(rawLine)) {
      const lastItem = list.items[list.items.length - 1];
      lastItem.inline.push(...parseInline(` ${line.trim()}`));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

function stripMarks(s: string): string {
  return s.replace(/\*\*|__/g, "").trim();
}

// The summary's sections, split by ## heading, so the report can put
// each on its own footing. Text before the first ## is kept under "".
export function splitSections(markdown: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  let current = { title: "", lines: [] as string[] };
  for (const line of markdown.split("\n")) {
    const m = /^##\s+(.*)$/.exec(line.trim());
    if (m && !line.trim().startsWith("###")) {
      if (current.title || current.lines.some((l) => l.trim())) {
        out.push({ title: current.title, body: current.lines.join("\n").trim() });
      }
      current = { title: stripMarks(m[1]), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.title || current.lines.some((l) => l.trim())) {
    out.push({ title: current.title, body: current.lines.join("\n").trim() });
  }
  return out;
}
