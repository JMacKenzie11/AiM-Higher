import "server-only";

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_CHARS } from "./attachments";

// Reads the text out of a file a leader attached in an agent
// conversation (attachments.ts). PDF through unpdf, Word through
// mammoth (as the transcript reader does), text and Markdown as they
// are. The file is read in memory and never stored.
//
// A refusal carries a sentence the chat shows as it is.

export type ExtractResult =
  | { ok: true; name: string; text: string; truncated: boolean }
  | { ok: false; message: string };

type Kind = "pdf" | "docx" | "text";

function kindOf(name: string, type: string): Kind | null {
  const n = name.toLowerCase();
  if (type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || n.endsWith(".docx")) return "docx";
  if (type.startsWith("text/") || n.endsWith(".txt") || n.endsWith(".md")) return "text";
  return null;
}

export async function extractAttachment(file: { name: string; type: string; bytes: Uint8Array }): Promise<ExtractResult> {
  const kind = kindOf(file.name, file.type);
  if (!kind) return { ok: false, message: "That kind of file can't be read here. Attach a PDF, Word (.docx) or text file." };
  if (file.bytes.byteLength > ATTACHMENT_MAX_BYTES) return { ok: false, message: "That file is over 4 MB. Attach a smaller one, or paste the part that matters." };

  let text: string;
  try {
    if (kind === "pdf") {
      const pdf = await getDocumentProxy(file.bytes);
      const out = await extractText(pdf, { mergePages: true });
      text = out.text;
    } else if (kind === "docx") {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) })).value;
    } else {
      text = new TextDecoder("utf-8").decode(file.bytes);
    }
  } catch {
    return { ok: false, message: "That file couldn't be read. If it's open somewhere or password-protected, save a copy and try again, or paste the text." };
  }

  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) {
    return {
      ok: false,
      message:
        kind === "pdf"
          ? "There's no text in that PDF to read; it may be a scan. Paste the text instead."
          : "That file is empty.",
    };
  }
  const truncated = text.length > ATTACHMENT_MAX_CHARS;
  return { ok: true, name: file.name, text: text.slice(0, ATTACHMENT_MAX_CHARS), truncated };
}
