import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { dataBlocks, type Guidance } from "./guidance-blocks";

export { dataBlocks };

// GUIDANCE THAT COMES WITH ITS DATA (Jason, 2026-11-26). How to use a
// strengths profile, and how to voice each kind of memory note, used to
// sit in leadership-coach.md and went out on every message. They now
// ride on the latest user turn beside the block they are about, and only
// when that block is there (guidance-blocks.ts says exactly when).
// Read once per server instance.
let loaded: Promise<Guidance> | null = null;

export function loadGuidance(): Promise<Guidance> {
  loaded ??= (async () => {
    const dir = path.join(process.cwd(), "prompts", "guidance");
    const [strengths, memory] = await Promise.all([
      fs.readFile(path.join(dir, "strengths.md"), "utf8"),
      fs.readFile(path.join(dir, "memory.md"), "utf8"),
    ]);
    return { strengths: strengths.trim(), memory: memory.trim() };
  })();
  loaded.catch(() => {
    loaded = null;
  });
  return loaded;
}
