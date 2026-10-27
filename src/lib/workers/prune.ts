import type Anthropic from "@anthropic-ai/sdk";

// Screenshots are the dearest thing a worker sends: each one is read
// again on every later turn. Only the last few are kept; an older one
// is replaced by a line saying it was there, so the model still knows
// it looked. Returns a new list; the run keeps the full one.

export const PRUNED_IMAGE_TEXT = "(An earlier screenshot, removed to save space.)";

type Block = { type: string; [k: string]: unknown };

export function pruneImages(messages: Anthropic.MessageParam[], keep: number): Anthropic.MessageParam[] {
  let seen = 0;
  const out = [...messages];
  for (let m = out.length - 1; m >= 0; m--) {
    const msg = out[m];
    if (msg.role !== "user" || typeof msg.content === "string") continue;
    let changed = false;
    const content = (msg.content as unknown as Block[]).map((block) => {
      if (block.type !== "tool_result" || !Array.isArray(block.content)) return block;
      const inner = (block.content as Block[]).map((c) => {
        if (c.type !== "image") return c;
        seen += 1;
        if (seen <= keep) return c;
        changed = true;
        return { type: "text", text: PRUNED_IMAGE_TEXT };
      });
      return changed ? { ...block, content: inner } : block;
    });
    if (changed) out[m] = { ...msg, content: content as unknown as Anthropic.MessageParam["content"] };
  }
  return out;
}
