import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeOverall,
  scoreForRow,
  SCORE_WEIGHTS,
  SCORE_CUTOVER_ISO,
  SCORE_PART_DESCRIPTIONS,
  AIMS_WEEKLY_SECTIONS,
} from "./score";
import { findBannedPhrases } from "@/lib/voice/banned";

const parts = (pf: number | null, a: number | null, r: number | null, al: number | null, ag: number | null) => ({
  positive_framing: pf,
  accountability: a,
  rhythm: r,
  alignment: al,
  agenda: ag,
});

describe("SCORE_WEIGHTS", () => {
  it("is Jason's five, summing to 100", () => {
    expect(SCORE_WEIGHTS).toEqual({
      positive_framing: 25,
      accountability: 25,
      rhythm: 20,
      alignment: 15,
      agenda: 15,
    });
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("computeOverall", () => {
  it("weights the five parts, with agenda 5/5 scaled to 10", () => {
    // 8*25 + 6*25 + 7*20 + 6*15 + 10*15 = 200 + 150 + 140 + 90 + 150 = 730
    const s = computeOverall(parts(8, 6, 7, 6, 5))!;
    expect(s).toMatchObject({ hundredths: 730, oneDecimal: "7.3", rounded: 7 });
    expect(s.lines.map((l) => l.key)).toEqual([
      "positive_framing",
      "accountability",
      "rhythm",
      "alignment",
      "agenda",
    ]);
    expect(s.lines.at(-1)).toMatchObject({ raw: 5, outOf: 5, scaled: 10, weight: 15 });
  });

  it("rounds half up at each precision on its own, without floating point drift", () => {
    // 7*25 + 6*25 + 7*20 + 6*15 + 6*15 = 175 + 150 + 140 + 90 + 90 = 645:
    // 6.45 is 6.5 to one decimal, and so 7 on the strip. The strip
    // rounds the figure shown beside it (Jason, 2026-09-25: "7.5, shown
    // as 7" read as a mistake).
    expect(computeOverall(parts(7, 6, 7, 6, 3))).toMatchObject({
      hundredths: 645,
      oneDecimal: "6.5",
      rounded: 7,
    });
    // 7*25 + 6*25 + 6*20 + 6*15 + 4*15 = 175 + 150 + 120 + 90 + 60 = 595:
    // 5.95 is 6.0 to one decimal, and 6 on the strip.
    expect(computeOverall(parts(7, 6, 6, 6, 2))).toMatchObject({
      hundredths: 595,
      oneDecimal: "6.0",
      rounded: 6,
    });
    // 6*25 + 6*25 + 6*20 + 5*15 + 6*15 = 150 + 150 + 120 + 75 + 90 = 585:
    // 5.85 is 5.9 to one decimal, and 6 on the strip.
    expect(computeOverall(parts(6, 6, 6, 5, 3))).toMatchObject({
      hundredths: 585,
      oneDecimal: "5.9",
      rounded: 6,
    });
  });

  it("scores a perfect and an empty meeting at the ends of the scale", () => {
    expect(computeOverall(parts(10, 10, 10, 10, 5))).toMatchObject({
      hundredths: 1000,
      oneDecimal: "10.0",
      rounded: 10,
    });
    expect(computeOverall(parts(0, 0, 0, 0, 0))).toMatchObject({ hundredths: 0, oneDecimal: "0.0", rounded: 0 });
  });

  it("gives no overall when any part is missing", () => {
    // Including positive framing: it is a part now, not an extra.
    expect(computeOverall(parts(null, 6, 7, 6, 5))).toBeNull();
    // The E13 case: an agenda score and no dimensions block must stay
    // unscored, so the review's one retry fires.
    expect(computeOverall(parts(null, null, null, null, 3))).toBeNull();
  });

  it("clamps out-of-range parts rather than trusting them", () => {
    const s = computeOverall(parts(8, 14, 7, 6, 9))!;
    expect(s.lines.find((l) => l.key === "accountability")!.raw).toBe(10);
    expect(s.lines.find((l) => l.key === "agenda")!.raw).toBe(5);
  });

  it("takes other weights without touching anything else", () => {
    const even = { positive_framing: 20, accountability: 20, rhythm: 20, alignment: 20, agenda: 20 };
    // (8 + 6 + 7 + 6 + 10) / 5 = 7.4
    expect(computeOverall(parts(8, 6, 7, 6, 5), even)).toMatchObject({ hundredths: 740, oneDecimal: "7.4" });
  });
});

describe("scoreForRow", () => {
  const review = { insufficient_transcript: false, overall: 9 };
  const stored = {
    score_positive_framing: 8,
    score_accountability: 6,
    score_rhythm: 7,
    score_alignment: 6,
    score_agenda: 5,
    score_weights: { ...SCORE_WEIGHTS },
  };

  it("computes a meeting analysed on or after the cutover, from its own stored parts", () => {
    const out = scoreForRow({ ...stored, created_at: SCORE_CUTOVER_ISO }, review)!;
    expect(out.kind).toBe("computed");
    expect(out.value).toBe(7.3);
  });

  it("uses the weights stored on the row, not today's", () => {
    const even = { positive_framing: 20, accountability: 20, rhythm: 20, alignment: 20, agenda: 20 };
    const out = scoreForRow({ ...stored, score_weights: even, created_at: "2026-10-01T00:00:00Z" }, review)!;
    expect(out.value).toBe(7.4);
  });

  it("keeps an older meeting's original score, and never back-computes it", () => {
    const out = scoreForRow({ ...stored, created_at: "2026-09-24T23:59:59Z" }, review)!;
    expect(out).toEqual({ kind: "original", value: 9 });
  });

  it("keeps the original when a later row has no stored parts", () => {
    expect(scoreForRow({ created_at: "2026-10-01T00:00:00Z" }, review)).toEqual({ kind: "original", value: 9 });
  });

  it("has no score for an insufficient transcript, or a review without one", () => {
    expect(scoreForRow(null, { insufficient_transcript: true, overall: null })).toBeNull();
    expect(scoreForRow({ created_at: "2026-09-01T00:00:00Z" }, { insufficient_transcript: false, overall: null })).toBeNull();
  });
});

describe("the real Benson case", () => {
  it("7.45 shows as 7.5 and as 8", () => {
    // 7*25 + 7*25 + 7*20 + 7*15 + 10*15 = 175 + 175 + 140 + 105 + 150 = 745
    expect(computeOverall(parts(7, 7, 7, 7, 5))).toMatchObject({ hundredths: 745, oneDecimal: "7.5", rounded: 8 });
  });
});

describe("SCORE_PART_DESCRIPTIONS", () => {
  it("has one for every weighted part, and nothing else", () => {
    expect(Object.keys(SCORE_PART_DESCRIPTIONS).sort()).toEqual(Object.keys(SCORE_WEIGHTS).sort());
  });

  it("names the same five sections, in the same order, in Rhythm and Agenda sections", () => {
    const list = AIMS_WEEKLY_SECTIONS.join("; ");
    expect(SCORE_PART_DESCRIPTIONS.rhythm).toContain(list);
    expect(SCORE_PART_DESCRIPTIONS.agenda).toContain(list);
  });

  it("names them as the facilitation prompt does", () => {
    const prompt = readFileSync(join(process.cwd(), "src/lib/leadership/facilitation/prompt.v2.md"), "utf8");
    AIMS_WEEKLY_SECTIONS.forEach((name, i) => {
      expect(prompt).toContain(`**Section ${i + 1} — ${name}**`);
    });
  });

  it("passes the voice checks like any user-facing copy", () => {
    for (const text of Object.values(SCORE_PART_DESCRIPTIONS)) {
      expect(findBannedPhrases(text)).toEqual([]);
      expect(text).not.toMatch(/[—–]/);
    }
  });
});

describe("the help page", () => {
  it("carries the same five definitions as the tooltips, word for word", () => {
    const help = readFileSync(join(process.cwd(), "docs/help/leadership.meetings._id.md"), "utf8").replace(/\s+/g, " ");
    for (const text of Object.values(SCORE_PART_DESCRIPTIONS)) {
      expect(help).toContain(text);
    }
  });
});
