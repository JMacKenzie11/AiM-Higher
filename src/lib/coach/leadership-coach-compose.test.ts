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

const LEADERSHIP_COACH_BASE_SHA =
  "02409ada0c8dd4a69bc1a434296dc172cb2b22903ba8f474f58e443e7020f825";

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
