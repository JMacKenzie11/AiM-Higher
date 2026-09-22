import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// Byte guard on the Role Description Builder's prompt, the way
// leadership-coach-compose.test.ts guards the coach's.
//
// The prompt IS the agent. There is no code path that decides
// whether it asks one question at a time or five, or whether it
// emits the document once or after every exchange; the file says so
// and nothing else does. A quiet edit to it is a behaviour change
// with no diff anybody reviews as one.
//
// If this fails, that is the guard working. Regenerate the SHA
// deliberately after the change (`shasum -a 256` the file) so an
// edit to how the agent interviews stays an act somebody performed
// rather than something that happened.
//
// ---- WHY THERE IS ALSO A LINE-LEVEL CHECK ---------------------
//
// A SHA guard fails loudly and is then satisfied by pasting in the
// new SHA, which is exactly what somebody does when they are sure
// their edit was fine. The two rules asserted below are the ones
// whose removal would be invisible in the product until a leader
// met it: an agent that bundles questions still answers, and an
// agent that emits two documents in one turn still produces a card.
// Both would look like the agent working.

const PROMPT = path.join(
  process.cwd(),
  "prompts/practices/role-description.md"
);

// Generated 2026-09-22, at the file's first landing.
//
// Regenerated 2026-09-22, and saying it out loud: section 7 gained
// the positive-framing standard. The agent proposed "the VP walks
// sites often enough to catch a drifting habit before it becomes an
// incident report" as what a safety value looks like lived well,
// which defines excellence as an averted bad outcome. AiMS runs on
// appreciative inquiry and ask-better-questions.md already states
// the rule this broke: frame movement toward something wanted, not
// away from something unwanted. The section now carries five tests,
// the failing line as a worked counter-example, and a read-back
// check before moving on. The "why it matters" line on a critical
// success factor gained the same lens.
//
// Regenerated again 2026-09-22, same day, and saying this one out
// loud too: the prompt now CARRIES the schema. It said "JSON in the
// card's shape" and never stated the shape, so the first real
// conversation guessed — `title` for `category`, `behavior` for
// `behaviour`, `decides_alone` for `decides`, and a bare string for
// `function`. Every guess was reasonable English. Two of them would
// have saved a document with holes in it rather than failing.
//
// Regenerated 2026-09-22 a third time, said out loud: the prompt
// gained a revision branch. A saved document is revised in a NEW
// conversation, because the one it came from is private to whoever
// held it, so the agent has to be able to pick up finished work it
// did not write. The rule that matters there is "change only what
// they ask for": a revision that re-runs the interview is how a
// one-line fix becomes a chore, and one that quietly rewrites prose
// nobody mentioned loses somebody's words.
//
// Regenerated 2026-09-22, fourth and last today: the revision
// opener stopped describing the document. It is rendered above the
// conversation now, server-side from the saved version, so an agent
// summarising it back was reading aloud from a page the person is
// looking at.
const ROLE_DESCRIPTION_PROMPT_SHA =
  "4a73cd57ba7469111c7c1baa23b1af37a8292def08b461df9aac0525eec6a87c";

async function read(): Promise<string> {
  return fs.readFile(PROMPT, "utf8");
}

describe("the role description prompt", () => {
  it("is byte-identical to the version that was reviewed", async () => {
    const sha = createHash("sha256").update(await read()).digest("hex");
    expect(
      sha,
      "prompts/practices/role-description.md changed. If that was deliberate, " +
        "regenerate ROLE_DESCRIPTION_PROMPT_SHA and say in the commit what the " +
        "agent now does differently."
    ).toBe(ROLE_DESCRIPTION_PROMPT_SHA);
  });

  // One question at a time is the difference between an interview
  // and a form. A model that has lost this rule sends a numbered
  // list of eight questions and the leader answers three of them.
  it("still says to ask one question at a time", async () => {
    const src = await read();
    expect(src).toMatch(/Ask one question at a time\./);
    expect(src).toMatch(/Never bundle two questions into one message/);
  });

  // Two blocks in one turn means two cards, each with its own Save,
  // and a leader who saves the wrong one. The card cannot tell them
  // apart; only this rule stops them existing.
  it("still says never to emit two blocks in one turn", async () => {
    const src = await read();
    expect(src).toMatch(/Never emit two blocks in one turn\./);
    expect(src).toMatch(/Emit the block once, at the end/);
  });

  // The two calls the agent cannot work without, named in the file
  // rather than assumed from the registry.
  it("still calls both tools before the first question", async () => {
    const src = await read();
    expect(src).toMatch(/Call `get_foundation` and `list_functions`/);
  });

  // Function and title are two questions on purpose. "Marketing" is
  // a function and "Marketing Manager" is a title, and an agent that
  // conflates them writes a document titled after a box.
  it("still asks the function and the title separately", async () => {
    const src = await read();
    expect(src).toMatch(/Ask this separately from the function, every time\./);
  });

  // The failure mode this section is most prone to, and the one a
  // leader met in the first real conversation. An excellence
  // standard written as an averted disaster aims the seat at the
  // disaster: what people focus on grows.
  it("still holds excellence to positive framing", async () => {
    const src = await read();
    expect(src).toMatch(
      /never what is prevented, caught, avoided, or kept from going wrong/
    );
    // The five tests, by name, so removing one is a visible edit.
    for (const test of [
      "Present, not averted",
      "Observable, present tense",
      "Specific to this seat",
      "A repeatable standard, not a highlight",
      "Recognisable",
    ]) {
      expect(src).toContain(test);
    }
    // The worked counter-example. A rule without the failing case
    // beside it is a rule a model reads past.
    expect(src).toMatch(/before it becomes an incident report/);
    expect(src).toMatch(/does this describe something happening, or something not happening\?/);
  });

  // The schema, in the file the model actually reads. Naming the
  // three near misses is the load-bearing part: a field list alone
  // did not stop the model reaching for `title`, because `title` is
  // what that field is called in ordinary English.
  it("still carries the exact schema and names the near misses", async () => {
    const src = await read();
    for (const field of [
      '"category"',
      '"behaviour"',
      '"decides"',
      '"decides_with"',
      '"recommends"',
      '"why_it_matters"',
      '"supports_functions"',
    ]) {
      expect(src).toContain(field);
    }
    expect(src).toMatch(/`category` is not `title`/);
    expect(src).toMatch(/`behaviour` is not `behavior`/);
    expect(src).toMatch(/`decides` is not `decides_alone`/);
    // The id, which is what ties a saved document to its seat.
    expect(src).toMatch(/Never a bare string/);
  });

  // Revision. The failure modes here are both quiet: re-running the
  // interview wastes the reviser's time, and rewriting untouched
  // sections loses the original author's words without telling
  // anybody.
  it("still revises rather than re-interviews", async () => {
    const src = await read();
    expect(src).toMatch(/Do not re-run the interview\./);
    // The document is on screen. An agent describing it back is
    // reading aloud from the page.
    expect(src).toMatch(/THE DOCUMENT IS ALREADY ON THEIR SCREEN/);
    expect(src).toMatch(/Do not describe it back to them/);
    expect(src).toMatch(/Change only what they ask for\./);
    expect(src).toMatch(
      /Every other section survives exactly as written, word for word/
    );
    // The standards do not lapse because it is an edit.
    expect(src).toMatch(/passes the same five tests as an original one/);
  });

  // One level of measures. The two-level model came out in migration
  // 0216 and this agent must not quietly bring it back.
  it("still forbids an outcomes layer under the critical success factors", async () => {
    const src = await read();
    expect(src).toMatch(
      /Do not create outcomes with measures hanging beneath them\./
    );
  });
});
