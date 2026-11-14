import type Anthropic from "@anthropic-ai/sdk";

// Small readers of a model reply, used by every coach call.

// The reply's text, its text blocks joined; thinking and tool calls
// are not text.
export function textOf(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export type TurnUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

// Adds one call's usage to a turn's running total.
export function addUsage(total: TurnUsage, usage: Partial<Anthropic.Usage> | null | undefined): void {
  if (!usage) return;
  total.input_tokens += usage.input_tokens ?? 0;
  total.output_tokens += usage.output_tokens ?? 0;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
  total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
}
