import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { privateDir, removedText, fingerprint } from "./propose-summary-redactions.ts";
import { personalDetailMatcher } from "@/lib/voice/personal-detail";

const repo = process.cwd();

describe("where the proposals go", () => {
  it("refuses the repository and anything inside it, creating nothing", () => {
    expect(() => privateDir(repo, repo)).toThrow(/inside the repository/);
    const inside = path.join(repo, "tmp-proposals-must-not-exist");
    expect(() => privateDir(inside, repo)).toThrow(/inside the repository/);
    expect(existsSync(inside)).toBe(false);
  });

  it("accepts a folder outside it", () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "redactions-")), "proposals");
    expect(privateDir(out, repo)).toMatch(/proposals$/);
  });
});

describe("what a proposal lists", () => {
  const match = personalDetailMatcher({ mode: "record", people: ["Lee Ortiz"] });
  const row = {
    analysis_markdown: "The quote goes out Friday. Lee was off sick on Tuesday.",
    commitments_json: [{ description: "Cover Lee while she is on maternity leave" }],
    issues_json: [{ title: "Quote timing" }],
    coverage_json: null,
    facilitation_review_json: { note: "Lee named owners. She shared her surgery date." },
  };

  it("names each sentence and item that would go, and nothing else", () => {
    expect(removedText(row, match)).toEqual([
      "Lee was off sick on Tuesday.",
      "Commitment: Cover Lee while she is on maternity leave",
      "She shared her surgery date.",
    ]);
  });

  it("fingerprints the row as stored, so a changed row is refused later", () => {
    expect(fingerprint(row)).toBe(fingerprint({ ...row }));
    expect(fingerprint(row)).not.toBe(fingerprint({ ...row, analysis_markdown: "changed" }));
  });
});
