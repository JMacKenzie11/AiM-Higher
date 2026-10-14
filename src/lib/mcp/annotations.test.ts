import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Jason, 2026-10-14: every add tool is marked so an assistant treats it
// as a write and asks the person first. No add tool may be labelled
// read only, and no read tool may be labelled a write.
const route = readFileSync(join(__dirname, "..", "..", "app", "api", "mcp", "route.ts"), "utf8");

const tools = [...route.matchAll(/registerTool\(\s*"([a-z_]+)",[\s\S]*?annotations:\s*([A-Z_]+)/g)].map((m) => ({
  name: m[1],
  annotations: m[2],
}));

describe("tool annotations", () => {
  it("finds every tool", () => {
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["who_am_i", "measures", "add_commitment", "add_issue", "add_measure_value"])
    );
  });

  it("marks every add as a write, never read only", () => {
    const adds = tools.filter((t) => t.name.startsWith("add_"));
    expect(adds).toHaveLength(3);
    for (const t of adds) expect(t.annotations).toBe("ADDS");
    expect(route).toMatch(/const ADDS = \{ readOnlyHint: false, destructiveHint: false/);
  });

  it("marks every other tool read only", () => {
    for (const t of tools.filter((x) => !x.name.startsWith("add_"))) expect(t.annotations).toBe("READ_ONLY");
  });

  it("tells the assistant to ask the person before each add", () => {
    for (const name of ["add_commitment", "add_issue", "add_measure_value"]) {
      const block = route.slice(route.indexOf(`"${name}"`), route.indexOf("annotations: ADDS", route.indexOf(`"${name}"`)));
      expect(block).toContain("Ask the person before calling this.");
    }
  });
});
