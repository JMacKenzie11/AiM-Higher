import { describe, it, expect } from "vitest";
import { computeStatus } from "./board";

// CHARACTERISATION TESTS for computeStatus.
//
// This is the single rule that decides what colour every cell on the
// 13-week board turns, and it is duplicated in spirit by the
// performance cron's off-target branch. The CSF/KPI refactor makes
// CSFs measurable, which means this rule starts running against a
// kind of row it has never seen, including CSFs with no target — a
// case decision 1 makes normal rather than exceptional.
//
// Pinned here so the refactor cannot quietly change what "off target"
// means. A wrong colour on this board is the kind of error a leader
// acts on before anyone notices it was wrong.

const NUM = { valueType: "number" as const, direction: "higher_is_better" as const };

describe("computeStatus — the no-target case", () => {
  it("returns no_target when the measure has no target, even with a value", () => {
    // This is the case decision 1 makes routine: a CSF that has been
    // named and is collecting values, with a target still to come. It
    // must never read as off.
    expect(computeStatus({ target: null, ...NUM }, { number: 42, text: null })).toBe(
      "no_target"
    );
  });

  it("returns no_target when the target is present but unparseable", () => {
    expect(
      computeStatus({ target: "soon", ...NUM }, { number: 42, text: null })
    ).toBe("no_target");
  });
});

describe("computeStatus — unlogged", () => {
  it("returns unlogged when there is no entry at all", () => {
    expect(computeStatus({ target: "10", ...NUM }, null)).toBe("unlogged");
  });

  it("returns unlogged when a numeric measure has a null number", () => {
    expect(
      computeStatus({ target: "10", ...NUM }, { number: null, text: null })
    ).toBe("unlogged");
  });

  it("returns unlogged when a numeric measure has a non-finite number", () => {
    expect(
      computeStatus({ target: "10", ...NUM }, { number: NaN, text: null })
    ).toBe("unlogged");
  });

  it("returns unlogged when a text measure has an empty string", () => {
    expect(
      computeStatus(
        { target: "yes", valueType: "text", direction: "higher_is_better" },
        { number: null, text: "   " }
      )
    ).toBe("unlogged");
  });
});

describe("computeStatus — higher is better", () => {
  it("counts equal to target as good, not off", () => {
    // The boundary. Off-by-one here silently marks every exactly-on-
    // target week as a miss.
    expect(
      computeStatus({ target: "95", ...NUM }, { number: 95, text: null })
    ).toBe("good");
  });

  it("counts above target as good and below as off", () => {
    expect(
      computeStatus({ target: "95", ...NUM }, { number: 96, text: null })
    ).toBe("good");
    expect(
      computeStatus({ target: "95", ...NUM }, { number: 94, text: null })
    ).toBe("off");
  });
});

describe("computeStatus — lower is better", () => {
  const LOW = { valueType: "number" as const, direction: "lower_is_better" as const };

  it("flips the comparison", () => {
    expect(computeStatus({ target: "5", ...LOW }, { number: 4, text: null })).toBe(
      "good"
    );
    expect(computeStatus({ target: "5", ...LOW }, { number: 6, text: null })).toBe(
      "off"
    );
  });

  it("still counts equal to target as good", () => {
    expect(computeStatus({ target: "5", ...LOW }, { number: 5, text: null })).toBe(
      "good"
    );
  });
});

describe("computeStatus — text measures", () => {
  const TXT = { valueType: "text" as const, direction: "higher_is_better" as const };

  it("matches case-insensitively and ignores surrounding space", () => {
    expect(
      computeStatus({ target: "Yes", ...TXT }, { number: null, text: " yes " })
    ).toBe("good");
  });

  it("counts any other text as off", () => {
    expect(
      computeStatus({ target: "Yes", ...TXT }, { number: null, text: "No" })
    ).toBe("off");
  });
});

describe("computeStatus — target parsing", () => {
  it("strips currency and separators before comparing", () => {
    expect(
      computeStatus({ target: "$1,200", ...NUM }, { number: 1200, text: null })
    ).toBe("good");
  });

  it("handles a percent-shaped target", () => {
    expect(
      computeStatus(
        { target: "95%", valueType: "percent", direction: "higher_is_better" },
        { number: 95, text: null }
      )
    ).toBe("good");
  });

  it("handles negative targets", () => {
    expect(
      computeStatus(
        { target: "-5", valueType: "number", direction: "lower_is_better" },
        { number: -6, text: null }
      )
    ).toBe("good");
  });
});

describe("computeStatus — field-name tolerance", () => {
  it("accepts either the camelCase or the snake_case shape", () => {
    // The board passes valueType/direction; callers reading straight
    // from a DB row pass value_type/target_direction. Both are live,
    // and the refactor will add more callers.
    expect(
      computeStatus(
        { target: "10", value_type: "number", target_direction: "higher_is_better" },
        { number: 11, text: null }
      )
    ).toBe("good");
  });
});
