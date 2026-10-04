import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import type { CoachTool } from "./tools";

// WHAT AiMS IS, IN AiMS'S OWN WORDS (Jason, 2026-10-04).
//
// Asked about AiMS, Aimee had only what her prompts say in passing.
// docs/AiMSContext holds the institute's own documents, and the two
// whose names start with GLOBAL are the ones that describe AiMS itself:
// the core beliefs (principles, beliefs, shifts, practices, the
// disciplines) and the AiMS point of view (what a management system
// is, what AiMS modernises, the regenerative lens).
//
// READ FROM THE FILES THEMSELVES, every GLOBAL*.docx in the folder, so
// a new version dropped in replaces the old with nothing to regenerate
// and no second copy to drift. The .docx is turned into plain text
// with headings and bullets kept (mammoth's HTML, then the tags
// flattened), once per server instance. The folder is bundled for
// Vercel in next.config.ts.
//
// NEVER A CLIENT'S COMPANY. Both documents open by saying they must
// never inform a company's own information. The tool says so to the
// model: this is AiMS describing itself.

const FOLDER = path.join(process.cwd(), "docs", "AiMSContext");

export type AimsDocument = { title: string; text: string };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

// mammoth's HTML to readable text: a heading keeps a "#" mark, a list
// item a "- ", a paragraph its own line; every other tag goes.
export function htmlToText(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>/g, (_, n: string) => `\n\n${"#".repeat(Math.min(Number(n) + 1, 4))} `)
    .replace(/<\/h[1-6]>/g, "\n")
    .replace(/<li[^>]*>/g, "\n- ")
    .replace(/<\/(p|li|ul|ol|table|tr)>/g, "\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/t[dh]>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/^(#+|-)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let cached: Promise<AimsDocument[]> | null = null;

export function loadAimsDocuments(folder = FOLDER): Promise<AimsDocument[]> {
  const load = async () => {
    const names = (await fs.readdir(folder)).filter((n) => /^GLOBAL/i.test(n) && n.toLowerCase().endsWith(".docx")).sort();
    return Promise.all(
      names.map(async (name) => {
        const { value } = await mammoth.convertToHtml({ path: path.join(folder, name) });
        return { title: name.replace(/\.docx$/i, ""), text: htmlToText(value) };
      })
    );
  };
  if (folder !== FOLDER) return load();
  cached ??= load().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

export function makeAboutAimsTool(): CoachTool {
  return {
    definition: {
      name: "about_aims",
      description:
        "AiMS in its own words: the AiMS core beliefs (the Appreciative Inquiry principles they rest on, each belief, the shifts and the practices) and the AiMS point of view (what a management system is, what AiMS keeps and what it modernises in People, Data, Rhythms and Strategy, and the regenerative lens). " +
        "Use it when the person asks about AiMS itself: what it is, what it believes, why it works the way it does, what a discipline is for. Answer from it in your own words, briefly, and connect it to their situation when you can. " +
        "It describes AiMS, the institute and its approach. It is never information about the person's own company: do not treat anything in it as a fact about their business.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      try {
        const documents = await loadAimsDocuments();
        if (documents.length === 0) return { status: "unavailable" as const, reason: "no AiMS documents found" };
        return { status: "ok" as const, documents };
      } catch {
        return { status: "unavailable" as const, reason: "the AiMS documents could not be read" };
      }
    },
  };
}
