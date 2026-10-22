import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WIN_PATTERNS } from "./win-patterns";

// Every slug a win row can name resolves to a pattern on disk, and the
// slug fits the column's check (0294).

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("win patterns", () => {
  it("has five patterns with unique slugs the database accepts", () => {
    expect(WIN_PATTERNS).toHaveLength(5);
    const slugs = WIN_PATTERNS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z_]{1,60}$/);
  });

  it("knows every slug referenced in the module, its pages and the harness", () => {
    const known = new Set(WIN_PATTERNS.map((p) => p.slug));
    const sources = [
      ...files("src/lib/diagnostics").filter((f) => !f.endsWith("win-patterns.ts")),
      ...files("src/app/(app)/diagnostics"),
      "scripts/rls-harness.ts",
    ];
    const used = new Set<string>();
    for (const f of sources) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/pattern(?:\s*:\s*|\s*=\s*|', ')['"]([a-z_]+)['"]/g)) used.add(m[1]);
      for (const m of text.matchAll(/'([a-z_]+)', '[^']*', true\)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const s of used) expect(known.has(s), `${s} is not in WIN_PATTERNS`).toBe(true);
  });
});
