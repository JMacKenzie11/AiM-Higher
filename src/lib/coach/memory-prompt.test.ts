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
  "3b5fcf1245151c23e0fe3118dff4267dadd2e8e78a8ec0e51f4dc1c8d7c59bdc";

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

  // THE INFERENCE RULE, added 2026-09-15 after a real memory page
  // showed every `said` line paired with a hedged restatement of
  // itself labelled `inferred` — four rows carrying two ideas. The
  // prompt had "one idea per memory" and nothing saying an inference
  // must add something the person did not say.
  //
  // Asserted line by line, not by SHA, because the paragraph could
  // keep its heading and lose the sentence that bites. The numeral in
  // the cap is asserted too: it is duplicated in
  // MAX_INFERRED_PER_CONVERSATION, and a prompt that promises a
  // different number than the code enforces is worse than no promise.
  it("still tells the model an inference must add something, and caps them", async () => {
    const raw = await fs.readFile(
      path.join(process.cwd(), "prompts", "coach-memory.md"),
      "utf8"
    );
    expect(raw).toContain(
      "Never write an inference that restates something you already captured as `said`"
    );
    expect(raw).toMatch(/A line earns `inferred` when it says something the person did \*\*not\*\*/i);
    expect(raw).toMatch(/keep the inference and drop the statement/i);
    expect(raw).toContain("At most 2 of your memories may be `inferred`.");
    // And that the model is told the cap is first-come, which is the
    // behaviour parseMemoryResponse actually implements.
    expect(raw).toMatch(/keeps the first two/i);
  });

  // ABOUT MODE. For a time the product owner had observations and
  // assessments of a team member captured like anything else; on
  // 2026-10-01 he reversed it.
  // Jason, 2026-10-01: a conversation about someone else is
  // remembered only as the asker's goals and plan. memory-shape.ts
  // (aboutAnotherVerdict) drops what gets through; these hold the
  // prompt to the same rule, line by line, so an edit that softens it
  // cannot pass by regenerating the SHA.
  it("still carries the about-mode rules the record depends on", async () => {
    const raw = await fs.readFile(
      path.join(process.cwd(), "prompts", "coach-memory.md"),
      "utf8"
    );
    // Only the asker's side is kept, and never a judgment of the other person.
    expect(raw).toMatch(/Keep only what the person you were talking with is working on/i);
    expect(raw).toMatch(/Never keep what they, or you, think of the other person/i);
    expect(raw).toContain("Said Marcus keeps missing the Thursday handoff.");
    expect(raw).not.toMatch(/Write their observations and assessments of the person too/i);
    expect(raw).toMatch(/dropped in code/i);
    // Provenance is not accuracy, for the person's own words. Added
    // after the E2E caught the summarizer demoting a statement to
    // `inferred` because the coach had challenged it.
    expect(raw).toMatch(/`said` is about provenance, not accuracy/i);
    expect(raw).toContain('Never write a memory of the form "believes X, but this is not validated"');
    // The never-written list, explicitly covering the other person.
    expect(raw).toMatch(
      /The never-written list applies to everyone the conversation mentions/i
    );
    expect(raw).toContain("Marcus is out for surgery");
    // And the naming rule a six-month-old memory depends on.
    expect(raw).toMatch(/Name the person, never a bare pronoun/i);
  });
});
