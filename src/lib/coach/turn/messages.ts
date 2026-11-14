import type Anthropic from "@anthropic-ai/sdk";
import type { CoachingMessage } from "@/lib/coach/service";

export function buildMessages(
  history: ReadonlyArray<Pick<CoachingMessage, "role" | "content">>,
  contextPrefix: string
): Anthropic.MessageParam[] {
  // The dynamic <company_context>/<person_context>/<coaching_context>
  // block is prepended to the LATEST user message only. Prepending
  // context to a stable earlier turn would keep growing the token
  // count without any benefit, and would blow the prompt cache too.
  const messages: Anthropic.MessageParam[] = [];
  history.forEach((m, idx) => {
    const isLast = idx === history.length - 1;
    if (m.role === "user" && isLast) {
      messages.push({
        role: "user",
        content: `${contextPrefix}${m.content}`,
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  });
  return messages;
}

// CACHE MARKS ON THE CONVERSATION (2026-11-14). The system prompt was
// the only cached part, so every tool pass and every retry sent the
// whole history again at full price, and so did the next message.
// Two marks, with the system prompt's that is three of the four the
// API allows:
//   - the end of what is being sent, so the next tool pass or the
//     retry reads all of it from the cache;
//   - the reply before the person's latest message, the last point
//     the next message will send unchanged (the latest message loses
//     its context prefix next time), so a reply within five minutes
//     reads the conversation so far from the cache.
// The marks go on copies; what is saved and passed on is untouched.
export function withCacheMarks(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out = messages.slice();
  const mark = (i: number) => {
    const m = out[i];
    if (!m) return;
    const blocks: Anthropic.ContentBlockParam[] =
      typeof m.content === "string"
        ? [{ type: "text", text: m.content }]
        : (m.content as Anthropic.ContentBlockParam[]).slice();
    const last = blocks[blocks.length - 1];
    if (!last || (last.type === "text" && last.text.length === 0)) return;
    // Thinking blocks cannot carry a mark; the end of a message never is one.
    if (last.type === "thinking" || last.type === "redacted_thinking") return;
    blocks[blocks.length - 1] = { ...last, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
    out[i] = { ...m, content: blocks };
  };
  mark(out.length - 1);
  let latestUser = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user" && typeof messages[i].content === "string") {
      latestUser = i;
      break;
    }
  }
  if (latestUser > 0 && latestUser - 1 !== out.length - 1) mark(latestUser - 1);
  return out;
}
