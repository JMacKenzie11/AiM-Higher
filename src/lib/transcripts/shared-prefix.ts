import type Anthropic from "@anthropic-ai/sdk";

// ONE CACHED TRANSCRIPT FOR EVERY CALL IN A MEETING.
//
// A meeting's analysis makes six to ten calls, and every one of them
// used to send the whole transcript as fresh input: the speaker map,
// the analysis, the extraction, the facilitation review and its
// retry, the coverage check, and the questions and their retry. The
// transcript is most of each call's input, so most of a meeting's
// input bill was the same text sent again.
//
// ---- WHY THE PREFIX IS BUILT THIS WAY ----------------------------
//
// A cache entry is a byte-identical PREFIX, read in the order tools,
// then system, then messages. The calls had four different tools,
// so no two of them shared even their first byte, and marking the
// transcript cacheable where it sat (in each call's user message)
// would have cached nothing across calls. So every call in the
// meeting's TOOL calls now send:
//
//   tools      the tool calls: all four pipeline tools, in one fixed
//              order, each call forcing its own with tool_choice.
//              The text calls (analysis, extraction): no tools.
//   system[0]  the transcript, marked cacheable.
//   system[1]  that call's own instructions.
//
// That makes two shared prefixes, and one more:
//   - speaker map, coverage, questions: the speaker map runs first and
//     alone, so it writes the entry and the other two read it.
//   - the analysis and the extraction are NOT on it. They answer in
//     text, and start together, so neither could read the other's
//     entry: marked, both would pay the write premium for nothing.
//     They are sent exactly as before.
//   - the facilitation review writes its own, because it is the one
//     call that leaves thinking on, and a thinking change breaks the
//     match; its retry reads it.
//
// MEASURED, NOT ASSUMED (2026-09-25). The first version gave the text
// calls the tools too, with tool_choice none, to make one prefix for
// all six. On the fixture meeting the extraction came back EMPTY (one
// output token) and the summary was 66 characters. A text call must
// not carry tools.
//
// A call made outside a meeting (a script, a test) passes no prefix
// and behaves exactly as before.

export type SharedPrefix = {
  tools: Anthropic.Tool[];
  transcript: Anthropic.TextBlockParam;
};

export function buildSharedPrefix(transcript: string, tools: Anthropic.Tool[]): SharedPrefix {
  return {
    tools,
    transcript: {
      type: "text",
      text: `<transcript>\n${transcript}\n</transcript>`,
      cache_control: { type: "ephemeral" },
    },
  };
}

// The request fields for one call: the shared prefix when there is
// one, the call's own tool otherwise. `ownTool` null means the call
// answers in text.
export function prefixed(
  shared: SharedPrefix | undefined,
  system: string,
  ownTool: Anthropic.Tool | null
): {
  system: Anthropic.TextBlockParam[];
  tools?: Anthropic.Tool[];
  tool_choice?: Anthropic.ToolChoice;
} {
  const own: Anthropic.TextBlockParam = { type: "text", text: system };
  const tools = ownTool
    ? { tools: shared ? shared.tools : [ownTool], tool_choice: { type: "tool" as const, name: ownTool.name } }
    : {};
  return {
    system: shared ? [shared.transcript, own] : [own],
    ...tools,
  };
}

// Where the transcript goes in the user message: nowhere when it is
// already in the system prompt, as before otherwise.
export function transcriptInMessage(shared: SharedPrefix | undefined, transcript: string): string {
  return shared
    ? "The meeting transcript is in the system prompt, inside <transcript> tags."
    : `<transcript>\n${transcript}\n</transcript>`;
}
