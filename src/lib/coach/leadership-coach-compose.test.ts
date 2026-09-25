import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// Byte-equivalence guard for the leadership-coach.md ↔ aims-voice.md
// split (see loadCoachBase in src/app/api/coach/route.ts).
//
// The base coach prompt was split into two files so a new
// voice_only practice can load aims-voice.md alone without the
// coaching-spine content. To prove the split preserves the
// existing behavior for every coach + practice conversation, we
// hash the recomposed base and assert it matches the SHA of the
// pre-split file.
//
// If someone changes the voice section or the remainder, this test
// fails — that's the point. Regenerate LEADERSHIP_COACH_BASE_SHA
// intentionally after the change (shasum -a 256 the recomposed
// output) so voice/tone edits stay a deliberate act, not a drive-
// by.

// Regenerated 2026-09-25, saying it out loud: one word. The memory
// rule said "do not quietly stop mentioning it", and "quietly" is on
// the banned list the coach's own output is checked against; it now
// says "silently". prompts-vs-banned.test.ts holds every prompt to the
// banned list, and this was one of the phrases it found.
//
// Regenerated 2026-09-14 (twice): first for the tier-one history
// work, then for coach memory part 2, which added a "What you
// remember" section carrying the recall-framing rules and their
// worked examples. Both were deliberate edits to the coaching spine,
// which is exactly what this guard is here to make somebody say out
// loud.
//
// Original note, for the tier-one history work: the prompt
// gained a "Claims about the past" section carrying the provenance
// rule and its worked examples. A deliberate edit to the coaching
// spine, which is exactly the kind of change this guard is here to
// make somebody say out loud.
//
// Changed again 2026-09-15, saying it out loud: the memory section
// gained the `directed` kind and the `remember_this` tool. Two things
// in it are load-bearing. A directed memory is raised plainly rather
// than hedged, because the person asked for it and hedging their own
// instruction back at them is absurd. And a declined save is
// delivered as Aimee's answer with the work-shaped alternative, never
// saved in different words, even though they asked directly.
//
// Changed again 2026-09-14, and saying it out loud: the spine gained a
// terminal state and turns gained a length ceiling. A real conversation
// reached step 7, the leader said "I'll go try that test", and the coach
// produced four more turns averaging 243 words against replies averaging
// 9. Nothing was violating the spine. The spine had simply finished and
// nothing said to stop, while "one sharp question per turn" plus "never
// ask a question without a hypothesis alongside it" made the shortest
// legal turn a hypothesis and a question. The seven steps are untouched.
const LEADERSHIP_COACH_BASE_SHA =
  "bd9c247bd3f405819b0772a322fad302cecff405fe2c4093968532e89441983b";

describe("leadership-coach base composition", () => {
  it("splices aims-voice.md into leadership-coach.md byte-equivalent to the pre-split file", async () => {
    const root = process.cwd();
    const [remainder, voice] = await Promise.all([
      fs.readFile(path.join(root, "prompts", "leadership-coach.md"), "utf8"),
      fs.readFile(path.join(root, "prompts", "aims-voice.md"), "utf8"),
    ]);
    const composed = remainder.replace("{{AIMS_VOICE}}", voice);
    const sha = createHash("sha256").update(composed).digest("hex");
    expect(sha).toBe(LEADERSHIP_COACH_BASE_SHA);
  });

  it("leadership-coach.md contains exactly one {{AIMS_VOICE}} sentinel", async () => {
    const src = await fs.readFile(
      path.join(process.cwd(), "prompts", "leadership-coach.md"),
      "utf8"
    );
    const matches = src.match(/\{\{AIMS_VOICE\}\}/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
