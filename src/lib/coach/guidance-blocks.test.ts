import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dataBlocks } from "./guidance-blocks";

// NOTHING LOST, NOTHING LEAKED (Jason, 2026-11-26: "How do we make sure
// we don't screw anything up?"). The strengths and memory guidance moved
// out of leadership-coach.md to ride with their blocks. Every rule that
// moved must still reach Aimee whenever its block is there, a
// conversation without the block gets none of it, and the rules that
// must hold with no block at all stay in the base.

const base = readFileSync("prompts/leadership-coach.md", "utf8");
const guidance = {
  strengths: readFileSync("prompts/guidance/strengths.md", "utf8").trim(),
  memory: readFileSync("prompts/guidance/memory.md", "utf8").trim(),
};

// One line from each rule that moved, as it read in the base before.
const MOVED_STRENGTHS = [
  "The generative question is \"which of your strengths, applied deliberately, would move this?\"",
  "Pay particular attention to capable-but-draining strengths.",
  "Read the competence and energy pairs together.",
  "In about mode, help the leader see the team member's strengths as design material",
  "Never treat strengths as a box the person must stay inside",
  "If strengths data is marked incomplete or unavailable, say so when it becomes relevant",
];
const MOVED_MEMORY = [
  "**Frame memory as recall, always.**",
  "**`said` may be recalled plainly.**",
  "**`inferred` is offered tentatively, or not at all.**",
  "**Let them overwrite it.**",
  "**`directed` is theirs, and it outranks your judgement about it.**",
  "**They open with: \"I still haven't done the thing with Marcus.\"**",
  "**Memory holds `[inferred] Avoids conflict with people he manages directly`.**",
  "**They say: \"I never said I was worried about Priya.\"**",
];
// Rules that must hold even when there is no block: never moved.
const STAYS_IN_BASE = [
  "**A memory is a claim, not a fact.**",
  "**A person in your notes is not who this conversation is about until they say so.**",
  "**When memory is thin, say so.**",
  "**Never claim to remember what you were not given.**",
  "**When they ask you to remember something.**",
  "If the tool returns `declined`",
  "never invent, infer or guess their strengths",
];

const STRENGTHS = "<strengths_context>\n- Top strengths: Focus\n</strengths_context>";
const MEMORY = "<coach_memory>\n- [said] wants to delegate dispatch (3 days ago)\n</coach_memory>";

describe("guidance that comes with its data", () => {
  it("keeps the no-block rules in the base", () => {
    for (const line of STAYS_IN_BASE) expect(base).toContain(line);
  });

  it("says each moved rule once, in its guidance file, and not in the base", () => {
    for (const line of MOVED_STRENGTHS) {
      expect(guidance.strengths).toContain(line);
      expect(base).not.toContain(line);
    }
    for (const line of MOVED_MEMORY) {
      expect(guidance.memory).toContain(line);
      expect(base).not.toContain(line);
    }
  });

  it("sends every moved rule when its block is there, right after the block", () => {
    const { strengthsBlock, memoryBlock } = dataBlocks({ strengthsContext: STRENGTHS, memoryContext: MEMORY, voiceOnly: false, guidance });
    for (const line of MOVED_STRENGTHS) expect(strengthsBlock).toContain(line);
    for (const line of MOVED_MEMORY) expect(memoryBlock).toContain(line);
    expect(strengthsBlock.startsWith(STRENGTHS)).toBe(true);
    expect(memoryBlock.startsWith(MEMORY)).toBe(true);
  });

  it("sends none of it without the block", () => {
    expect(dataBlocks({ strengthsContext: null, memoryContext: null, voiceOnly: false, guidance })).toEqual({
      strengthsBlock: "",
      memoryBlock: "",
    });
  });

  it("leaves a voice-only agent's memory block as it was", () => {
    const { memoryBlock } = dataBlocks({ strengthsContext: null, memoryContext: MEMORY, voiceOnly: true, guidance });
    expect(memoryBlock).toBe(`${MEMORY}\n\n`);
  });
});
