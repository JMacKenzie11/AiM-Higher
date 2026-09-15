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
  "1c0a623a1604fc8b0eb901851e188e1012f8c18d81c531379487c63f1b609148";

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

  // The about-mode frame rule, added 2026-09-14 when summarization was
  // extended to about-mode conversations. Asserted line by line rather
  // than by SHA alone, because this is precisely the paragraph a future
  // edit could soften without looking like it removed anything: the
  // section could keep its heading and lose the clause that makes it
  // bite. The code-side filter in memory-shape.ts is a backstop for
  // this prompt, not a replacement, and it can only see a claim that
  // names the person, which is why the naming rule is asserted too.
  it("still carries the about-mode frame rule that keeps the subject out", async () => {
    const raw = await fs.readFile(
      path.join(process.cwd(), "prompts", "coach-memory.md"),
      "utf8"
    );
    // Who the memory is about. The whole feature is this sentence.
    expect(raw).toMatch(/written \*\*about the leader\*\*/i);
    expect(raw).toContain("Never about the team member.");
    // The prohibition, and that neither kind escapes it.
    expect(raw).toMatch(/Never write a claim about the team member/i);
    expect(raw).toMatch(/not as `said`, not as `inferred`/i);
    expect(raw).toMatch(
      /An `inferred` reading of the team member is still a claim about the team member/i
    );
    // The near miss that the rule exists for. Losing this example is
    // how the rule would quietly stop catching the common case.
    expect(raw).toContain("Doubts whether Marcus is ready.");
    // The test that generalises beyond the examples.
    expect(raw).toMatch(/The transformation test/i);
    // What the filter depends on to see the subject at all.
    expect(raw).toMatch(/Name them, never a bare pronoun/i);
    // And that the absolute list is not relaxed for the subject.
    expect(raw).toMatch(/Health and family stay absolute/i);
  });
});
