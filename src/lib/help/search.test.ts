import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatHelpIndex, helpIndexFor, purposeOf, searchHelp } from "./search";

// Aimee may only use help the person's role may read, and only link to
// pages they can open (Jason, 2026-09-28). These run over the real
// help files, so a doc edit that leaks admin help fails here.

const ALL_FEATURES = ["execution", "strengths", "classroom", "role_descriptions"] as const;

describe("searchHelp: role and access", () => {
  it("never gives a team member admin-only help: the Agent Hub", async () => {
    const hits = await searchHelp("Agent Hub publish a version", "team_member", [...ALL_FEATURES]);
    expect(hits.map((h) => h.page)).not.toContain("Agent Hub");
    expect(hits.some((h) => (h.link ?? "").startsWith("/admin"))).toBe(false);
  });

  it("does give it to a system admin, so the search itself works", async () => {
    const hits = await searchHelp("Agent Hub publish a version", "system_admin", [...ALL_FEATURES]);
    expect(hits.map((h) => h.page)).toContain("Agent Hub");
  });

  it("never leaks the admin-only part of a doc everyone can read", async () => {
    // chart.function._id.role-description.md: a `::: role
    // company_admin,aims_guide,system_admin` block holds "Edit the
    // free-form prose".
    const member = await searchHelp("edit the free-form prose position summary", "team_member", [...ALL_FEATURES]);
    expect(member.some((h) => /Edit the free-form prose/i.test(h.text))).toBe(false);
    const admin = await searchHelp("edit the free-form prose position summary", "company_admin", [...ALL_FEATURES]);
    expect(admin.some((h) => /Edit the free-form prose/i.test(h.text))).toBe(true);
  });

  it("finds ordinary help, with a link the person can open", async () => {
    const hits = await searchHelp("how do I add a priority", "team_member", [...ALL_FEATURES]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.link === "/plan")).toBe(true);
  });

  it("returns nothing for a query of only filler words", async () => {
    expect(await searchHelp("how do I", "team_member", [...ALL_FEATURES])).toEqual([]);
  });
});

describe("helpIndexFor", () => {
  it("lists no admin page for a team member, and none behind a feature the company has not got", async () => {
    const paths = (await helpIndexFor("team_member", ["execution"])).map((p) => p.path);
    expect(paths.filter((p) => p.startsWith("/admin") || p === "/hq" || p === "/portfolio")).toEqual([]);
    expect(paths).not.toContain("/classroom");
    expect(paths).toContain("/plan");
  });

  it("gives every page a title and a purpose", async () => {
    const index = await helpIndexFor("system_admin", [...ALL_FEATURES]);
    expect(index.filter((p) => !p.title || !p.purpose).map((p) => p.path)).toEqual([]);
  });

  it("formats to one line a page, inside its own block", async () => {
    const text = formatHelpIndex([{ path: "/plan", title: "Goals & Priorities", purpose: "Where the quarter's work lives." }]);
    expect(text).toContain("- Goals & Priorities (/plan): Where the quarter's work lives.");
    expect(text.startsWith("<app_pages>")).toBe(true);
  });
});

describe("purposeOf", () => {
  it("takes the first sentence after the title", () => {
    expect(purposeOf("# Plan\n\nWhere the **quarter's** work lives. More detail.\n\n## How")).toBe(
      "Where the quarter's work lives."
    );
  });
});
