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
  "85428fa7bb54e9659ca03c5662e162b5187170053c97b93d6a0e110d6544f9ec";

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

  // ABOUT MODE. The frame rule that lived here briefly is gone, by
  // the product owner's decision: observations and assessments of a
  // team member are captured like anything else. Two things carry the
  // weight now, and both are asserted line by line rather than left
  // to the SHA, because either could be softened by an edit that
  // looks like tidying and removes nothing visible.
  //
  //   1. The said/inferred split applied to observations about the
  //      SUBJECT. Without it, Aimee's guess about a team member
  //      becomes something the leader is told they said.
  //   2. The never-written list covering the subject. Without it,
  //      health and family about a third party start being written
  //      down, which no decision has ever authorised.
  it("still carries the about-mode rules the record depends on", async () => {
    const raw = await fs.readFile(
      path.join(process.cwd(), "prompts", "coach-memory.md"),
      "utf8"
    );
    // Observations of the subject are captured at all.
    expect(raw).toMatch(
      /Write their observations and assessments of the person too/i
    );
    // (1) The split, applied to those observations specifically.
    expect(raw).toMatch(/The said\/inferred split does all the work here/i);
    expect(raw).toContain(
      "Never promote your read of the person to `said`."
    );
    expect(raw).toMatch(
      /The leader's statement about the person is `said`/i
    );
    expect(raw).toMatch(/Your own read of the person is `inferred`/i);
    // Provenance is not accuracy. Added after the E2E caught the
    // summarizer demoting a leader's own statement to `inferred`
    // because the coach had challenged it in-conversation, and
    // writing "believes X, but this belief is not yet validated" in
    // its place. That is the model's assessment of the claim standing
    // where the leader's words should be.
    expect(raw).toMatch(/`said` is about provenance, not accuracy/i);
    expect(raw).toContain('Never write a memory of the form "believes X, but this is not validated"');
    // (2) The never-written list, explicitly covering the subject.
    expect(raw).toMatch(
      /The never-written list applies to everyone the conversation mentions/i
    );
    expect(raw).toContain("Marcus is out for surgery");
    // And the naming rule a six-month-old memory depends on.
    expect(raw).toMatch(/Name the person, never a bare pronoun/i);
  });
});
