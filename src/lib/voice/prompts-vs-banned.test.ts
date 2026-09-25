import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PHRASES } from "./banned";

// NO PROMPT MAY USE A PHRASE ITS OWN CHECKER BANS.
//
// The questions prompt said "invites the room" and "keeps the room on
// the problem" while banned.ts bans "the room", and the questions call
// retried in 8 of 9 regression runs (2026-09-25). A prompt that models
// the phrase and a checker that refuses it is the E10 shape: one
// instruction reverted in one layer while its twin lives on in another.
//
// WHAT COUNTS AS A PROMPT. Every markdown file under prompts/, the
// facilitation prompt in use, and every source file that calls the
// model (messages.create or messages.stream), comments removed. Found,
// not listed, so a new prompt is covered the day it is written.
//
// WHAT IS ALLOWED. A banned phrase in quotation marks: that is a prompt
// citing what not to say ("Not 'that headline'"). And the explicit
// banned lists themselves (a section opened by "Never use these words
// or phrases" or "Banned words and phrases", to the next heading).

const root = process.cwd();

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

function withoutComments(ts: string): string {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/\s.*$/, "")))
    .join("\n");
}

function withoutBannedLists(text: string): string {
  return text.replace(
    /(never use these words or phrases|banned words and phrases)[\s\S]*?(?=\n\*\*|\n#|$)/gi,
    " "
  );
}

function withoutQuoted(text: string): string {
  return text.replace(/"[^"\n]*"|“[^”\n]*”|'[^'\n]{1,80}'|\*"[^"\n]*"\*/g, " ");
}

function bannedIn(text: string): string[] {
  const t = withoutQuoted(withoutBannedLists(text)).toLowerCase();
  return PHRASES.filter((p) => t.includes(p.toLowerCase()));
}

const MARKDOWN = [
  ...walk("prompts", (p) => p.endsWith(".md")),
  "src/lib/leadership/facilitation/prompt.v2.md",
];
const CODE = walk("src", (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)).filter((p) =>
  /messages\.(create|stream)\(/.test(readFileSync(join(root, p), "utf8"))
);

describe("no prompt uses a phrase the banned list bans", () => {
  it("finds the prompts it is guarding", () => {
    // A control: a guard that found nothing to scan would pass forever.
    expect(MARKDOWN.length).toBeGreaterThan(5);
    expect(CODE).toEqual(expect.arrayContaining(["src/lib/leadership/questions.ts", "src/lib/guide/headline.ts"]));
  });

  it.each(MARKDOWN)("%s", (file) => {
    expect(bannedIn(readFileSync(join(root, file), "utf8"))).toEqual([]);
  });

  it.each(CODE)("%s", (file) => {
    expect(bannedIn(withoutComments(readFileSync(join(root, file), "utf8")))).toEqual([]);
  });

  it("would catch the real case", () => {
    expect(bannedIn("- Invites the room. It never assigns anyone.")).toEqual(["the room"]);
    // And lets a prompt cite a banned phrase as what not to say.
    expect(bannedIn('Never mention it as a thing. Not "that headline".')).toEqual([]);
  });
});
