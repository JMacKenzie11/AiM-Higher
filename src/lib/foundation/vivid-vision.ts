// THE VIVID VISION BLOCK (Jason, 2026-10-27; structured 2026-11-02).
//
// The Vivid Vision agent (prompts/practices/vivid-vision.md) writes the
// finished document as a fenced block tagged vivid_vision. Since
// 2026-11-02 the block carries a little structure, so the same text can
// be shown in the chat, downloaded as a PDF laid out like the AiMS
// examples, and saved to the One-Page Plan as plain text:
//
//   # Title
//   The tagline
//
//   ## The Story
//   (optional opening paragraphs)
//   ### A section headline
//   A paragraph with **one key line in bold**.
//
//   ## Proof Points: What 2036 Looks Like
//   ### A group
//   - **A bold lead**, then the rest
//
//   ## What We Protect: Five Things That Don't Change
//   - **A short label.** What it means.
//
//   ## Strategic Focus Themes: Where We Put Our Energy
//   ### Theme name
//   A one-line subtitle
//   A short paragraph.
//
//   ## Closing
//   One closing line.
//
//   ## One-Page Plan Summary
//   A short paragraph or two: what the One-Page Plan saves.
//
// A section heading's part after the colon is its display heading; the
// part before names which section it is. Blocks written before the
// structure (plain text, section names on their own line) still parse,
// and save exactly as they did.
//
// The One-Page Plan's Vision card shows its field as written
// (pre-wrap), so what is saved is plain text, with the markers taken
// out. Since 2026-11-02 the agent also writes a short summary, and the
// One-Page Plan saves that (`saveText`: title, tagline, summary); the
// PDF and Copy carry the whole document (`text`). A block with no
// summary saves the whole document, as before. The save reads the block from the saved message
// (vivid-vision-actions.ts), never from the browser.
//
// No imports: the chat (a client component) parses with it.

export const VIVID_VISION_TAG = "vivid_vision";

// The Vision field has no limit of its own; this one keeps a runaway
// reply off the One-Page Plan. A full vision is about 1,500 words.
export const VIVID_VISION_MAX = 20000;

// A paragraph is one or more lines, kept as written: some visions
// break a paragraph into short lines on purpose. **bold** marks stay
// in; splitBold() reads them.
export type StorySection = { headline: string; paragraphs: string[] };
export type ProofGroup = { name: string | null; items: string[] };
export type FocusTheme = { name: string; subtitle: string | null; body: string[] };

export type VividVisionDoc = {
  title: string;
  tagline: string | null;
  // Paragraphs of the story before its first headline.
  intro: string[];
  story: StorySection[];
  proof: { heading: string | null; groups: ProofGroup[] };
  protect: { heading: string | null; items: string[] };
  themes: { heading: string | null; items: FocusTheme[] };
  closing: string[];
  // What the One-Page Plan saves. Never in the PDF.
  summary: string[];
};

export type VividVision = {
  // The first line: the headline.
  title: string;
  // The document, read into its parts.
  doc: VividVisionDoc;
  // The whole document as plain text, no markers: Copy.
  text: string;
  // What Save to the One-Page Plan saves: the summary when there is
  // one, otherwise `text`.
  saveText: string;
};

type SectionKey = "story" | "proof" | "protect" | "themes" | "closing" | "summary";

// Which section a heading names, from the part before any colon.
function sectionKey(name: string): SectionKey | null {
  const n = name.toLowerCase();
  if (/summary|one-page plan/.test(n)) return "summary";
  if (/story/.test(n)) return "story";
  if (/proof/.test(n)) return "proof";
  if (/protect/.test(n)) return "protect";
  if (/focus|theme/.test(n)) return "themes";
  if (/clos/.test(n)) return "closing";
  return null;
}

// A plain-text block's section names, on a line of their own.
const LEGACY_SECTIONS = /^(the story|proof points|what we protect|strategic focus themes)$/i;

function stripBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*\*/g, "");
}

// Split a line into plain and bold runs, for the card and the PDF.
export function splitBold(s: string): Array<{ text: string; bold: boolean }> {
  const out: Array<{ text: string; bold: boolean }> = [];
  const re = /\*\*(.+?)\*\*/g;
  let at = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > at) out.push({ text: s.slice(at, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    at = m.index! + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at).replace(/\*\*/g, ""), bold: false });
  return out;
}

function emptyDoc(title: string): VividVisionDoc {
  return {
    title,
    tagline: null,
    intro: [],
    story: [],
    proof: { heading: null, groups: [] },
    protect: { heading: null, items: [] },
    themes: { heading: null, items: [] },
    closing: [],
    summary: [],
  };
}

// Read the block's lines into the document's parts.
function readDoc(lines: string[]): VividVisionDoc {
  const titleLine = lines[0] ?? "";
  const doc = emptyDoc(stripBold(titleLine.replace(/^#\s+/, "")).replace(/^_+|_+$/g, "").trim());
  let i = 1;
  // The tagline: the next line with something on it, if it is not a heading.
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && !/^#/.test(lines[i]) && !LEGACY_SECTIONS.test(lines[i].trim())) {
    doc.tagline = stripBold(lines[i].trim().replace(/^[_*]+|[_*]+$/g, "")).trim() || null;
    i++;
  }

  let section: SectionKey = "story";
  let para: string[] = [];
  // The story section, proof group or theme the next paragraph or item belongs to.
  let story: StorySection | null = null;
  let group: ProofGroup | null = null;
  let theme: FocusTheme | null = null;

  const flush = () => {
    if (para.length === 0) return;
    const p = para.join("\n");
    para = [];
    if (section === "story") (story ? story.paragraphs : doc.intro).push(p);
    else if (section === "closing") doc.closing.push(p);
    else if (section === "summary") doc.summary.push(p);
    else if (section === "themes" && theme) {
      // A theme's first line is its subtitle; the rest is its body.
      if (theme.subtitle === null && theme.body.length === 0) {
        const [first, ...rest] = p.split("\n");
        theme.subtitle = stripBold(first);
        if (rest.length) theme.body.push(rest.join("\n"));
      } else theme.body.push(p);
    }
    // A loose paragraph in a list section reads as one more item.
    else if (section === "proof") addProof(stripBullet(p));
    else if (section === "protect") doc.protect.items.push(stripBullet(p));
  };

  const stripBullet = (s: string) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
  const addProof = (item: string) => {
    if (!group) {
      group = { name: null, items: [] };
      doc.proof.groups.push(group);
    }
    group.items.push(item);
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    const h2 = /^##\s+(.*)$/.exec(t);
    const legacy = !h2 && LEGACY_SECTIONS.test(t) ? t : null;
    if ((h2 && !t.startsWith("###")) || legacy) {
      flush();
      const full = stripBold(h2 ? h2[1] : legacy!).trim();
      const colon = full.indexOf(":");
      const key = sectionKey(colon < 0 ? full : full.slice(0, colon));
      if (key) {
        section = key;
        const heading = colon < 0 ? null : full.slice(colon + 1).trim() || null;
        if (key === "proof") doc.proof.heading = heading;
        if (key === "protect") doc.protect.heading = heading;
        if (key === "themes") doc.themes.heading = heading;
        story = null;
        group = null;
        theme = null;
      } else if (section === "story") {
        // An unknown ## inside the story reads as a story headline.
        story = { headline: full, paragraphs: [] };
        doc.story.push(story);
      }
      continue;
    }
    const h3 = /^###\s+(.*)$/.exec(t);
    if (h3) {
      flush();
      const name = stripBold(h3[1]).replace(/^\d+[.)]?\s+/, "").trim();
      if (section === "story") {
        story = { headline: name, paragraphs: [] };
        doc.story.push(story);
      } else if (section === "proof") {
        group = { name, items: [] };
        doc.proof.groups.push(group);
      } else if (section === "themes") {
        theme = { name, subtitle: null, body: [] };
        doc.themes.items.push(theme);
      } else para.push(t);
      continue;
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/.test(line) && !/^\*\*/.test(t);
    if (bullet && section !== "story" && section !== "closing" && section !== "summary") {
      flush();
      const item = stripBullet(t);
      if (section === "proof") addProof(item);
      else if (section === "protect") doc.protect.items.push(item);
      else if (section === "themes") {
        // A plain-text block lists its themes as bullets: name only.
        theme = null;
        doc.themes.items.push({ name: item, subtitle: null, body: [] });
      }
      continue;
    }
    para.push(t);
  }
  flush();
  return doc;
}

// The plain text the One-Page Plan saves, from the document.
export function visionPlainText(doc: VividVisionDoc): string {
  const out: string[] = [doc.title];
  if (doc.tagline) out.push(doc.tagline);
  const block = (s: string) => out.push("", stripBold(s));
  for (const p of doc.intro) block(p);
  for (const s of doc.story) {
    out.push("", s.headline);
    s.paragraphs.forEach((p, n) => (n === 0 ? out.push(stripBold(p)) : block(p)));
  }
  if (doc.proof.groups.length) {
    out.push("", "Proof Points");
    for (const g of doc.proof.groups) {
      if (g.name) out.push(g.name);
      for (const item of g.items) out.push(`- ${stripBold(item)}`);
    }
  }
  if (doc.protect.items.length) {
    out.push("", "What We Protect");
    for (const item of doc.protect.items) out.push(`- ${stripBold(item)}`);
  }
  if (doc.themes.items.length) {
    out.push("", "Strategic Focus Themes");
    for (const t of doc.themes.items) {
      out.push(`- ${t.name}${t.subtitle ? `: ${t.subtitle}` : ""}`);
      for (const b of t.body) out.push(`  ${stripBold(b).replace(/\n/g, "\n  ")}`);
    }
  }
  for (const c of doc.closing) block(c);
  return out.join("\n").trim();
}

// What the One-Page Plan saves when the document has a summary: the
// title, the tagline, the summary.
export function visionSummaryText(doc: VividVisionDoc): string {
  return [[doc.title, doc.tagline].filter(Boolean).join("\n"), ...doc.summary.map(stripBold)].join("\n\n").trim();
}

// Null while nothing has arrived, or if what arrived is empty.
export function parseVividVision(raw: string): VividVision | null {
  const clean = raw.replace(/\r\n/g, "\n").trim().slice(0, VIVID_VISION_MAX);
  if (!clean) return null;
  const doc = readDoc(clean.split("\n"));
  if (!doc.title) return null;
  // A block with no markers is the plain text it always was, and saves
  // exactly as written, so a vision saved before still reads as saved.
  const structured = /^\s*#{1,3}\s/m.test(clean) || /\*\*.+?\*\*/.test(clean.slice(clean.indexOf("\n") + 1));
  const text = structured ? visionPlainText(doc) : clean;
  return { title: doc.title, doc, text, saveText: doc.summary.length ? visionSummaryText(doc) : text };
}

// The last vivid_vision block in a saved message, or null. The model is
// told to write one block per turn; the last one wins if it writes two.
export function vividVisionInMessage(content: string): VividVision | null {
  const re = new RegExp("```" + VIVID_VISION_TAG + "[^\\n]*\\n([\\s\\S]*?)\\n```", "g");
  let last: string | null = null;
  for (const m of content.matchAll(re)) last = m[1];
  return last === null ? null : parseVividVision(last);
}

// The year the vision describes: ten years on from when it was written.
export function visionYear(writtenAt: string | Date | null | undefined): number {
  const d = writtenAt ? new Date(writtenAt) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).getFullYear() + 10;
}

// CONNECTING THE TEAM TO THE VISION (Jason, 2026-11-02). The same on
// every vision, after the closing line: how the owner takes it to the
// team. Fixed text, never written by the agent.
export const TEAM_STEPS: ReadonlyArray<{ step: string; questions?: readonly string[] }> = [
  { step: "Bring your team together and read your Vivid Vision." },
  {
    step: "Ask them these questions:",
    questions: [
      "What ideas energized you most?",
      "What other ideas were emerging that you would also love to see?",
      "What questions come to mind?",
    ],
  },
  { step: "Give them some time to reflect individually, then ask them to share." },
  { step: "Tell them you'll incorporate their feedback into the Vision and reshare it with them." },
];

// Under the steps: where the feedback goes (Jason, 2026-11-02). The
// agent says the same in the chat after every vision it writes.
export const TEAM_RETURN_LINE =
  "When you have their feedback, return to your Vivid Vision conversation in AiMS-HQ and share it there. Aimee will update the vision with you, ready to share again.";
