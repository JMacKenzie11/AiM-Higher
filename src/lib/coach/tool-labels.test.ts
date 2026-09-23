import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toolLabel, LABELLED_TOOLS } from "./tool-labels";

// EVERY TOOL THE COACH CAN CALL HAS SOMETHING TO SAY WHILE IT RUNS.
//
// A model turn that ends in a tool call streams no text, so the
// bubble sat on "Thinking…" for a whole model call plus the tool
// round trip. Measured on one real conversation: 3,572 billed output
// tokens against a 215 word answer — roughly 3,200 tokens of tool
// arguments that nobody saw and everybody waited for.
//
// The failure this guards is quiet: a new tool gets registered, has
// no label, and its window falls back to a generic phrase. Nothing
// breaks, and the one screen that was supposed to explain the wait
// goes vague again.

const SOURCES = [
  "src/lib/coach/tools.ts",
  "src/lib/coach/history-tools.ts",
  "src/lib/coach/memory-tool.ts",
  "src/lib/role-descriptions/agent-tools.ts",
];

function registeredToolNames(): string[] {
  const names = new Set<string>();
  for (const file of SOURCES) {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    for (const m of src.matchAll(/name:\s*"([a-z_]+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

describe("tool labels", () => {
  const registered = registeredToolNames();

  it("finds the tools at all", () => {
    // A control. If the sources move, every assertion below would
    // pass on an empty list. E4.
    expect(registered.length).toBeGreaterThan(5);
  });

  it("has a label for every tool the coach registers", () => {
    const missing = registered.filter((n) => !LABELLED_TOOLS.includes(n));
    expect(missing, "tools with no label to show while they run").toEqual([]);
  });

  it("labels nothing that is not a tool any more", () => {
    // The other direction: a stale label is a phrase nobody will
    // ever see, sitting there looking maintained.
    const stale = LABELLED_TOOLS.filter((n) => !registered.includes(n));
    expect(stale, "labels for tools that no longer exist").toEqual([]);
  });

  it("never shows the caller a function name", () => {
    // Including for a tool it has never heard of. "get_role_description"
    // is the name of a function; somebody waiting on an answer about a
    // person they manage should not be shown the internals.
    for (const name of [...registered, "some_new_tool"]) {
      expect(toolLabel(name)).not.toContain("_");
    }
  });
});
