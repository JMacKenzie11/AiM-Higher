import "server-only";

import type { Role } from "@/lib/types";
import type { ModuleFeature } from "@/lib/subscriptions/service";
import { helpSlugsFor, linkablePagesFor, type PageEntry } from "@/lib/pages/registry";
import { loadAllHelpFor } from "./loader";
import type { HelpDoc } from "./loader";

// PRODUCT HELP FOR AIMEE: an index of the pages a person can open, and
// a search over the help they are allowed to read.
//
// Everything here starts from loadAllHelpFor(role): the docs the "?"
// widget would show this role, with other roles' sections already cut
// out. Nothing reads a help file any other way, so Aimee cannot quote
// admin-only help to a team member, and cannot link to a page that
// linkablePagesFor would not offer them.
//
// ---- WHY KEYWORD SEARCH ----------------------------------------------
//
// 30 docs, about 41,000 tokens (docs/investigations/aimee-panel.md).
// Written to one template, with headings that name the features, which
// is what keyword matching is good at. Embeddings would need a table on
// every instance, a pipeline to keep it current, and a second place
// role filtering has to be right, for a set of docs this size.

export type HelpIndexEntry = { path: string; title: string; purpose: string };

export type HelpHit = {
  page: string;
  section: string;
  text: string;
  link: string | null;
};

// The doc a page takes its title and purpose from: its own, or the
// nearest parent's, the way the loader falls back.
function docFor(entry: PageEntry, docs: readonly HelpDoc[]): HelpDoc | null {
  for (const slug of helpSlugsFor(entry.pattern)) {
    const doc = docs.find((d) => d.slug === slug);
    if (doc) return doc;
  }
  return null;
}

// The template opens with a one-sentence purpose under the title.
export function purposeOf(markdown: string): string {
  const para = markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0 && !p.startsWith("#") && !p.startsWith(":::"));
  if (!para) return "";
  const flat = para.replace(/\s+/g, " ").replace(/\*\*|__|`/g, "");
  // A full stop ends the sentence only when a capital or the end
  // follows, so "(e.g. 2026 Q3)" does not cut it short.
  const sentence = /^(.+?[.!?])(?=\s+[A-Z]|\s*$)/.exec(flat)?.[1] ?? flat;
  return sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
}

export async function helpIndexFor(role: Role, features: readonly ModuleFeature[]): Promise<HelpIndexEntry[]> {
  const docs = await loadAllHelpFor(role);
  const out: HelpIndexEntry[] = [];
  for (const entry of linkablePagesFor(role, features)) {
    const doc = docFor(entry, docs);
    // A page whose help this role cannot read is not advertised either.
    if (!doc) continue;
    out.push({ path: entry.pattern, title: entry.title ?? doc.title, purpose: purposeOf(doc.markdown) });
  }
  return out;
}

// The index as it goes into Aimee's prompt: one line a page.
export function formatHelpIndex(index: readonly HelpIndexEntry[]): string {
  if (index.length === 0) return "";
  return [
    "<app_pages>",
    "The pages of the AiMS app this person can open. When they ask where something is, or how to do",
    "something, name the page and link to it as a Markdown link with its path, e.g. [Goals & Priorities](/plan).",
    "Link only to paths on this list or returned by search_help. For how a feature works, call search_help.",
    "",
    ...index.map((p) => `- ${p.title} (${p.path}): ${p.purpose}`),
    "</app_pages>",
  ].join("\n");
}

// ---- Search ------------------------------------------------------------

const STOP = new Set(
  (
    "a an and are as at be by can do does for from how i if in is it its me my of on or " +
    "the this that to what when where which who why will with you your we our there " +
    "get use using want need find make see show help page"
  ).split(" ")
);

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, ""))
    .filter((w) => w.length > 1);
}

type Section = { slug: string; docTitle: string; heading: string; text: string };

function sectionsOf(doc: HelpDoc): Section[] {
  const out: Section[] = [];
  let heading = doc.title;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ slug: doc.slug, docTitle: doc.title, heading, text });
    buf = [];
  };
  for (const line of doc.markdown.split("\n")) {
    const h = /^#{1,3}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export async function searchHelp(
  query: string,
  role: Role,
  features: readonly ModuleFeature[],
  limit = 3
): Promise<HelpHit[]> {
  const wanted = terms(query);
  if (wanted.length === 0) return [];
  const docs = await loadAllHelpFor(role);
  const pages = linkablePagesFor(role, features);
  const linkFor = (slug: string): string | null =>
    pages.find((p) => helpSlugsFor(p.pattern)[0] === slug)?.pattern ??
    pages.find((p) => helpSlugsFor(p.pattern).includes(slug))?.pattern ??
    null;

  const scored = docs.flatMap(sectionsOf).map((s) => {
    const inHeading = terms(`${s.docTitle} ${s.heading}`);
    const inText = terms(s.text);
    let score = 0;
    for (const w of wanted) {
      score += inHeading.filter((t) => t === w).length * 3;
      score += Math.min(inText.filter((t) => t === w).length, 5);
    }
    return { s, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ s }) => ({
      page: s.docTitle,
      section: s.heading,
      text: s.text.length > 1800 ? `${s.text.slice(0, 1800)}\n...` : s.text,
      link: linkFor(s.slug),
    }));
}
