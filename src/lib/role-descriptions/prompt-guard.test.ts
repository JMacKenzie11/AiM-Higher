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

// Generated 2026-09-22, at the file's first landing. Not regenerated
// since.
const ROLE_DESCRIPTION_PROMPT_SHA =
  "0e4a71f02fc19c1e544c77bb339544628edfdbaf2657cabf49ee559e8c47f982";

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

  // One level of measures. The two-level model came out in migration
  // 0216 and this agent must not quietly bring it back.
  it("still forbids an outcomes layer under the critical success factors", async () => {
    const src = await read();
    expect(src).toMatch(
      /Do not create outcomes with measures hanging beneath them\./
    );
  });
});
