// THE VIVID VISION BLOCK (Jason, 2026-10-27).
//
// The Vivid Vision agent (prompts/practices/vivid-vision.md) writes the
// finished document as a fenced block tagged vivid_vision. The block is
// plain text, exactly as it will read on the One-Page Plan's Vision
// card, which shows the field as written (pre-wrap). So what the leader
// sees in the card is what they save. The save reads the text from the
// saved message (vivid-vision-actions.ts), never from the browser.
//
// No imports: the chat (a client component) parses with it.

export const VIVID_VISION_TAG = "vivid_vision";

// The Vision field has no limit of its own; this one keeps a runaway
// reply off the One-Page Plan. A full vision is about 1,500 words.
export const VIVID_VISION_MAX = 20000;

export type VividVision = {
  // The first line: the headline.
  title: string;
  // Everything after it.
  rest: string;
  // The whole text, as saved.
  text: string;
};

// Null while nothing has arrived, or if what arrived is empty.
export function parseVividVision(raw: string): VividVision | null {
  const text = raw.replace(/\r\n/g, "\n").trim().slice(0, VIVID_VISION_MAX);
  if (!text) return null;
  const nl = text.indexOf("\n");
  const title = (nl < 0 ? text : text.slice(0, nl)).replace(/^\*\*(.*)\*\*$/, "$1").trim();
  const rest = nl < 0 ? "" : text.slice(nl + 1).trim();
  return { title, rest, text };
}

// The last vivid_vision block in a saved message, or null. The model is
// told to write one block per turn; the last one wins if it writes two.
export function vividVisionInMessage(content: string): VividVision | null {
  const re = new RegExp("```" + VIVID_VISION_TAG + "[^\\n]*\\n([\\s\\S]*?)\\n```", "g");
  let last: string | null = null;
  for (const m of content.matchAll(re)) last = m[1];
  return last === null ? null : parseVividVision(last);
}
