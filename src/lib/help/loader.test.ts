import { describe, expect, it, vi } from "vitest";
import { filterRoleSections } from "./loader";

describe("filterRoleSections", () => {
  it("returns the doc unchanged when it has no role blocks", () => {
    const md = "# Intro\n\nSome content.\n\n## Section\n\nMore.";
    expect(filterRoleSections(md, "team_member")).toBe(md);
  });

  it("keeps blocks that include the caller's role", () => {
    const md = [
      "Header for everyone.",
      "",
      "::: role team_member",
      "TM-only line.",
      ":::",
      "",
      "Footer for everyone.",
    ].join("\n");
    const out = filterRoleSections(md, "team_member");
    expect(out).toContain("TM-only line.");
    expect(out).toContain("Header for everyone.");
    expect(out).toContain("Footer for everyone.");
    // The role fence itself is stripped.
    expect(out).not.toContain(":::");
    expect(out).not.toContain("role team_member");
  });

  it("hides blocks whose role list doesn't include the caller", () => {
    const md = [
      "Shared.",
      "",
      "::: role company_admin",
      "Admin only.",
      ":::",
      "",
      "Still shared.",
    ].join("\n");
    const out = filterRoleSections(md, "team_member");
    expect(out).not.toContain("Admin only.");
    expect(out).toContain("Shared.");
    expect(out).toContain("Still shared.");
  });

  it("supports comma-separated role lists", () => {
    const md = [
      "::: role company_admin,aims_guide,system_admin",
      "Admins + guides.",
      ":::",
    ].join("\n");
    expect(filterRoleSections(md, "aims_guide")).toContain("Admins + guides.");
    expect(filterRoleSections(md, "system_admin")).toContain(
      "Admins + guides."
    );
    expect(filterRoleSections(md, "team_member")).not.toContain(
      "Admins + guides."
    );
  });

  it("handles multiple blocks in the same doc", () => {
    const md = [
      "Top.",
      "::: role team_member",
      "TM.",
      ":::",
      "Middle.",
      "::: role company_admin",
      "Admin.",
      ":::",
      "Bottom.",
    ].join("\n");
    const tmOut = filterRoleSections(md, "team_member");
    expect(tmOut).toContain("TM.");
    expect(tmOut).not.toContain("Admin.");
    const adminOut = filterRoleSections(md, "company_admin");
    expect(adminOut).not.toContain("TM.");
    expect(adminOut).toContain("Admin.");
  });

  it("collapses excess blank lines left by stripped blocks", () => {
    const md = [
      "Line 1",
      "",
      "::: role company_admin",
      "Admin.",
      ":::",
      "",
      "Line 2",
    ].join("\n");
    const out = filterRoleSections(md, "team_member");
    // Should not have 3+ blank lines in a row.
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).toContain("Line 1");
    expect(out).toContain("Line 2");
  });

  it("fails open on an unclosed role block", () => {
    const md = [
      "Header.",
      "::: role team_member",
      "Never closed.",
      "More content.",
    ].join("\n");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = filterRoleSections(md, "company_admin");
    // Full markdown returned verbatim.
    expect(out).toBe(md);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("preserves leading/trailing whitespace within kept blocks", () => {
    const md = [
      "::: role team_member",
      "- Bullet 1",
      "- Bullet 2",
      ":::",
    ].join("\n");
    const out = filterRoleSections(md, "team_member");
    expect(out).toContain("- Bullet 1");
    expect(out).toContain("- Bullet 2");
  });

  it("tolerates extra whitespace around the role list", () => {
    const md = [
      "::: role   team_member ,  company_admin  ",
      "Kept.",
      ":::",
    ].join("\n");
    expect(filterRoleSections(md, "team_member")).toContain("Kept.");
    expect(filterRoleSections(md, "aims_guide")).not.toContain("Kept.");
  });
});
