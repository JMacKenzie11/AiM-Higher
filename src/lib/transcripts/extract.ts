import "server-only";

import mammoth from "mammoth";
import type { DownloadedFile } from "./provider";

// Turns a downloaded file into clean transcript text.
//   - Google Doc (exported as text/plain)  → passthrough
//   - text/plain                            → passthrough
//   - text/vtt                              → strip cue timestamps
//                                              and metadata lines; a
//                                              voice tag becomes
//                                              "Name: text"
//   - .docx                                 → mammoth extractRawText
//
// Anything else throws — the caller (cron) marks the meeting
// failed with the error text.

export type ExtractedTranscript = {
  text: string;
  // Best-effort title inferred from the file name (extension
  // stripped). The AI's structured output usually produces a
  // better title; this is only a placeholder.
  title: string;
};

export async function extractTranscript(
  file: DownloadedFile
): Promise<ExtractedTranscript> {
  const title = fileTitle(file.name);

  if (file.mimeType === "text/plain") {
    return { text: file.buffer.toString("utf8").trim(), title };
  }

  if (file.mimeType === "text/vtt" || /\.vtt$/i.test(file.name)) {
    return { text: cleanVtt(file.buffer.toString("utf8")), title };
  }

  if (
    file.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(file.name)
  ) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return { text: result.value.trim(), title };
  }

  throw new Error(`Unsupported file type: ${file.mimeType}`);
}

function fileTitle(name: string): string {
  return name.replace(/\.(txt|vtt|docx)$/i, "").replace(/[_-]+/g, " ").trim();
}

// WebVTT: strip WEBVTT header, cue numbers, timestamp lines, and
// styling metadata. Keep speaker labels and dialogue. Collapses
// consecutive blank lines into a single blank so paragraphs still
// separate speakers.
export function cleanVtt(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (/^WEBVTT/i.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue; // cue number
    if (/-->/i.test(trimmed)) continue; // timestamp line
    if (/^NOTE\b/i.test(trimmed)) continue;
    if (/^STYLE\b/i.test(trimmed)) continue;
    if (/^REGION\b/i.test(trimmed)) continue;
    // A voice tag names the speaker: <v Jason MacKenzie>text</v>.
    // Teams writes every cue this way, so stripping it like the other
    // tags threw away the one thing Teams knows for certain, who was
    // talking, and left the analysis guessing. Kept as "Name: text",
    // the form the speaker step already reads from other tools.
    const voice = /^<v(?:\.[^\s>]*)?\s+([^>]+)>/.exec(trimmed);
    // Then strip the remaining inline tags (<c.styled>, </v>, <b>).
    const cleaned = trimmed.replace(/<[^>]+>/g, "").trim();
    if (!cleaned) continue;
    out.push(voice ? `${voice[1].trim()}: ${cleaned}` : cleaned);
  }
  return out.join("\n").trim();
}
