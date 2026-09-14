import { describe, it, expect } from "vitest";
import { decide, exemptionIn } from "./check-docs-touched.ts";

// The docs gate.
//
// It is crude on purpose and easy to satisfy dishonestly, which is
// not a flaw to fix: a gate defeated by typing four words is not
// security, it is a prompt at the moment the author still remembers
// what they changed. These pin the shape of that prompt.

const body = (s: string) => s;

describe("decide", () => {
  it("fails a source change with no docs and no exemption", () => {
    const r = decide({ files: ["src/lib/companies/actions.ts"], body: "" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("no documentation with them");
  });

  it("passes when documentation changed alongside", () => {
    const r = decide({
      files: ["src/lib/companies/actions.ts", "docs/product-spec.md"],
      body: "",
    });
    expect(r.ok).toBe(true);
  });

  it("counts a help doc as documentation", () => {
    const r = decide({
      files: ["src/app/(app)/portfolio/page.tsx", "docs/help/portfolio.md"],
      body: "",
    });
    expect(r.ok).toBe(true);
  });

  it("counts CLAUDE.md, because a PR changing how we work documents itself", () => {
    const r = decide({ files: ["src/middleware.ts", "CLAUDE.md"], body: "" });
    expect(r.ok).toBe(true);
  });

  it("passes on a claimed exemption with a reason", () => {
    const r = decide({
      files: ["src/lib/companies/actions.ts"],
      body: body("Renames a variable.\n\nDocs-exempt: pure refactor\n"),
    });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("pure refactor");
  });

  it("still fails on a bare marker with no reason", () => {
    // Exempt is a claim somebody makes. A marker with nothing after
    // it is the claim without the making.
    const r = decide({
      files: ["src/lib/companies/actions.ts"],
      body: body("Docs-exempt:\n"),
    });
    expect(r.ok).toBe(false);
  });

  it("ignores tests, which prove behaviour rather than change it", () => {
    const r = decide({
      files: ["src/lib/companies/actions.test.ts"],
      body: "",
    });
    expect(r.ok).toBe(true);
  });

  it("ignores CSS modules", () => {
    // Arguable, and argued in the source: a restyle can be
    // user-visible, but a rule that fires on every spacing tweak
    // trains people to type the exemption without reading it. A
    // behaviour change that matters arrives with a .ts beside it.
    const r = decide({
      files: ["src/app/(app)/portfolio/portfolio.module.css"],
      body: "",
    });
    expect(r.ok).toBe(true);
  });

  it("fails when CSS is accompanied by a real source change", () => {
    const r = decide({
      files: [
        "src/app/(app)/portfolio/portfolio.module.css",
        "src/app/(app)/portfolio/PortfolioCompanyCard.tsx",
      ],
      body: "",
    });
    expect(r.ok).toBe(false);
  });

  it("passes a docs-only PR", () => {
    const r = decide({ files: ["docs/product-spec.md"], body: "" });
    expect(r.ok).toBe(true);
  });

  it("ignores changes outside src/, like the workflows and scripts", () => {
    // scripts/ is deliberately out: it is the tooling the deploy
    // ritual runs, and docs/deployment.md is where that is written
    // down — but a script change is not automatically a user-visible
    // one, and CLAUDE.md already requires the ritual doc to move
    // when the ritual does.
    const r = decide({
      files: [".github/workflows/checks.yml", "scripts/ship-batch.sh"],
      body: "",
    });
    expect(r.ok).toBe(true);
  });
});

describe("exemptionIn", () => {
  it("reads the reason", () => {
    expect(exemptionIn("Docs-exempt: test-only")).toBe("test-only");
  });

  it("is case-insensitive and tolerates leading space", () => {
    expect(exemptionIn("   docs-exempt:  Internal tooling ")).toBe(
      "Internal tooling"
    );
  });

  it("finds it on any line, not only the first", () => {
    expect(
      exemptionIn("Some description.\n\nMore.\n\nDocs-exempt: refactor\n")
    ).toBe("refactor");
  });

  it("returns null for a bare marker", () => {
    expect(exemptionIn("Docs-exempt:")).toBeNull();
    expect(exemptionIn("Docs-exempt:    ")).toBeNull();
  });

  it("returns null when absent", () => {
    expect(exemptionIn("A perfectly ordinary description.")).toBeNull();
  });

  it("does not match a mention inside prose", () => {
    // "the docs-exempt marker" in a sentence is somebody TALKING
    // about the rule, not invoking it. The anchor is what stops that.
    expect(
      exemptionIn("I thought about using the Docs-exempt marker here.")
    ).toBeNull();
  });
});
