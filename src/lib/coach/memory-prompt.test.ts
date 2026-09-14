import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// PROMPT GUARD for prompts/coach-memory.md, same discipline as the
// leadership-coach base composition guard.
//
// This prompt is where the said/inferred distinction and the
// never-written filter actually live. The code-side filter in
// memory-shape.ts is a blunt backstop that catches obvious misses; it
// cannot catch "has been going through it since the diagnosis"
// without the word, and nothing but the prompt can.
//
// So an edit here changes what gets permanently written down about
// people, and it should be a deliberate act with a reason, never a
// drive-by tidy. If this fails, regenerate the SHA intentionally:
//
//   shasum -a 256 prompts/coach-memory.md
const COACH_MEMORY_PROMPT_SHA =
  "76cc6ae0f1795345ab83775936c06e22cd64135a44b8ca34f9cb82a422470cea";

describe("coach memory prompt", () => {
  it("has not changed without the SHA being updated deliberately", async () => {
    const raw = await fs.readFile(
      path.join(process.cwd(), "prompts", "coach-memory.md"),
      "utf8"
    );
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      COACH_MEMORY_PROMPT_SHA
    );
  });

  it("still carries the rules the code depends on", async () => {
    // The SHA says "unchanged". These say "unchanged in the ways that
    // would break something downstream" — a regenerated SHA on an
    // edit that quietly removed the filter would otherwise pass.
    const raw = await fs.readFile(
      path.join(process.cwd(), "prompts", "coach-memory.md"),
      "utf8"
    );
    // The two kinds, and the tie-breaker the whole distinction rests on.
    expect(raw).toMatch(/"kind":\s*"said"/);
    expect(raw).toMatch(/"kind":\s*"inferred"/);
    expect(raw).toContain("When in doubt, `inferred`");
    // The filter, both halves.
    expect(raw).toContain("Never write these down");
    expect(raw).toMatch(/Health and medical, entirely/i);
    expect(raw).toMatch(/Family and personal life/i);
    // And the half that must NOT be filtered, which is easy to lose
    // to a well-meaning edit that widens the filter.
    expect(raw).toMatch(/Personnel and organisational thinking/i);
  });
});
