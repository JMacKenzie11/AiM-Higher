// FILES IN AN AGENT CONVERSATION (Jason, 2026-11-02).
//
// A leader can attach a file (PDF, Word, text) to a message in any
// agent conversation. The server reads the text out of it
// (attachment-extract.ts) and the file itself is never kept. The text
// travels INSIDE the user's message, wrapped in an <attached_file>
// block ahead of what they typed:
//
//   <attached_file name="Brand story.docx">
//   ...the file's text...
//   </attached_file>
//
//   What they typed.
//
// So it is stored, shared, read back on later turns and covered by RLS
// exactly as the message is, with no table or migration of its own;
// the model reads it as written; and the chat shows each block as a
// file chip (splitAttachments). Only blocks at the very start of a
// message count as files.
//
// No imports: the chat (a client component) uses it too.

// One file's text, after extraction. About 15,000 words; a brand
// guide or sales page is well under it.
export const ATTACHMENT_MAX_CHARS = 60_000;
export const ATTACHMENT_MAX_FILES = 3;
// The file as uploaded. Vercel refuses a request body over 4.5 MB.
export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
// What the picker offers, and what attachment-extract.ts reads.
export const ATTACHMENT_ACCEPT =
  ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

export type Attachment = { name: string; text: string };

const OPEN = "<attached_file";
const CLOSE = "</attached_file>";

function cleanName(name: string): string {
  const n = name.replace(/["<>\r\n]/g, "").trim().slice(0, 120);
  return n || "file";
}

// A file's text can never close its own block early.
function cleanText(text: string): string {
  return text.replaceAll(CLOSE, "</attached-file>").trim().slice(0, ATTACHMENT_MAX_CHARS);
}

// The message as stored: each file's block, then what they typed.
export function composeMessage(typed: string, files: readonly Attachment[]): string {
  const blocks = files
    .slice(0, ATTACHMENT_MAX_FILES)
    .map((f) => `${OPEN} name="${cleanName(f.name)}">\n${cleanText(f.text)}\n${CLOSE}`);
  return [...blocks, typed.trim()].filter(Boolean).join("\n\n");
}

export type SplitMessage = {
  files: Array<{ name: string; chars: number }>;
  // What they typed, with the files taken off the front.
  text: string;
};

// The files at the start of a stored message, and the rest.
export function splitAttachments(content: string): SplitMessage {
  const files: SplitMessage["files"] = [];
  let rest = content;
  const head = /^\s*<attached_file name="([^"]*)">\n?/;
  for (;;) {
    const m = head.exec(rest);
    if (!m) break;
    const end = rest.indexOf(CLOSE, m[0].length);
    if (end < 0) break;
    files.push({ name: m[1], chars: rest.slice(m[0].length, end).trim().length });
    rest = rest.slice(end + CLOSE.length);
  }
  return { files, text: files.length ? rest.trim() : content };
}

// A one-line stand-in for a message, for lists and snippets: the
// files by name, then what they typed.
export function messagePreviewText(content: string): string {
  const { files, text } = splitAttachments(content);
  if (!files.length) return content;
  const names = files.map((f) => `[${f.name}]`).join(" ");
  return text ? `${names} ${text}` : names;
}

// Said to every agent, after its own prompt.
export const ATTACHMENT_PROMPT_NOTE =
  "The leader can attach files (PDF, Word or text) to a message. A file arrives at the start of their message as an <attached_file name=\"...\"> block holding its text. Read it as material they gave you, use it where it helps, and refer to it by its name. Never quote a whole file back.";
