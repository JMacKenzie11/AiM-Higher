// Does a version say exactly what the code says? (0317)
//
// A version published unchanged from the code is marked follows_code,
// and a marked version runs whatever the code says now: a later change
// to the prompt file reaches it on release, with nobody republishing.
// A version anybody edited in the Hub keeps its own text, which is
// what the Hub is for.
//
// Every field the runtime reads is compared, not only the prompt. A
// version whose prompt is untouched but whose token ceiling was set in
// the Hub is an edit, and following the code would quietly undo it.

export type ComparableConfig = {
  prompt: string;
  chips: readonly string[];
  basePromptMode: string;
  skipSetup: boolean;
  firstTurn: string | null;
  scriptedOpener: string | null;
  tools: readonly string[];
  maxTokens: number | null;
  model: string | null;
};

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function matchesCode(version: ComparableConfig, code: ComparableConfig): boolean {
  return (
    version.prompt.trim() === code.prompt.trim() &&
    same(version.chips, code.chips) &&
    version.basePromptMode === code.basePromptMode &&
    version.skipSetup === code.skipSetup &&
    (version.firstTurn ?? null) === (code.firstTurn ?? null) &&
    (version.scriptedOpener ?? null) === (code.scriptedOpener ?? null) &&
    same(version.tools, code.tools) &&
    (version.maxTokens ?? null) === (code.maxTokens ?? null) &&
    (version.model ?? null) === (code.model ?? null)
  );
}
