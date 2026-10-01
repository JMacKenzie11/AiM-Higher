import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { privateDir, analysisChanges, pageChanges, fingerprint, totals } from "./propose-summary-redactions.ts";
import { personalDetailMatcher } from "@/lib/voice/personal-detail";

const repo = process.cwd();
const match = personalDetailMatcher({ mode: "record", people: ["Lee Ortiz", "Pat Kim"] });

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
  const analysis = {
    id: "a1",
    meeting_id: "m1",
    analysis_markdown: "The quote goes out Friday. Lee was off sick on Tuesday. His father founded the company.",
    commitments_json: [{ description: "Pat covers Lee's accounts while Lee is on maternity leave" }],
    issues_json: [{ title: "Quote timing" }],
    coverage_json: null,
    facilitation_review_json: { note: "Lee named owners. She shared her surgery date." },
  };

  it("lists the sentences taken out and the items reworded, from the analysis", async () => {
    const reword = vi.fn(async () => ["Pat covers Lee's accounts"]);
    const { changes } = await analysisChanges(analysis, match, reword);
    expect(changes.map((c) => [c.where, c.before, c.after])).toEqual([
      ["Summary", "Lee was off sick on Tuesday.", ""],
      ["Facilitation review", "She shared her surgery date.", ""],
      ["Meeting record: commitment", "Pat covers Lee's accounts while Lee is on maternity leave", "Pat covers Lee's accounts"],
    ]);
  });

  it("covers the Commitments and Issues pages, labels what a person wrote, and never drops a row", async () => {
    const reword = vi.fn(async (texts: readonly string[]) => texts.map((t) => (t.startsWith("Pat covers") ? "Pat covers Lee's accounts" : null)));
    const changes = await pageChanges(
      [{ id: "c1", source_meeting_id: "m1", description: "Pat covers Lee's accounts while Lee is on maternity leave", clarity_note: null, missed_reason: "I was off sick" }],
      [{ id: "i1", source_meeting_id: "m1", title: "Quote timing", desired_outcome: null }],
      match,
      reword
    );
    expect(changes.map((c) => [c.where, c.writtenBy, c.after])).toEqual([
      ["Commitments page: description", "AiMS", "Pat covers Lee's accounts"],
      ["Commitments page: missed reason", "a person", null],
    ]);
    expect(totals([{ instance: "@", meetingId: "m1", company: "", meetingDate: "", meetingTitle: "", fingerprints: {}, changes, analysisAfter: null }])).toEqual({
      meetings: 1, removed: 0, reworded: 1, marked: 1, byPerson: 1,
    });
  });

  it("fingerprints a row as read, so an edited row is refused later", () => {
    expect(fingerprint(analysis)).toBe(fingerprint({ ...analysis }));
    expect(fingerprint(analysis)).not.toBe(fingerprint({ ...analysis, analysis_markdown: "changed" }));
  });
});
