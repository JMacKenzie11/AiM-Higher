import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadHelpForRoute, loadAllHelpFor } from "./loader";
import { ADMIN_ONLY_CONTROLS, ADMIN_ONLY_TOOLS } from "./admin-only-controls";

// THE HELP A TEAM MEMBER READS NAMES NOTHING THEY CAN'T USE (2026-09-29).
//
// Aimee answers from this help (search_help reads it cut to the
// person's role), so a leak here is a leak in what she tells them. For
// every page everyone can open but only admins can change, the team
// member's version of its help names none of the admin-only controls,
// and no page's team-member help mentions the admin-only tools.

const plain = (md: string) => md.replace(/[*_`]/g, "");

describe("the help a team member gets", () => {
  for (const { path: page, controls, helpPhrases } of ADMIN_ONLY_CONTROLS) {
    it(`on ${page}, names none of the admins' actions`, async () => {
      const doc = await loadHelpForRoute(page, "team_member");
      expect(doc, `${page} has no help for a team member`).not.toBeNull();
      const text = plain(doc!.markdown);
      // The buttons, as labelled.
      for (const c of controls.map((c) => c.replace(/^\+ /, ""))) {
        expect(text, `${page}: "${c}" is in a team member's help`).not.toContain(c);
      }
      // The help's own words for those actions, in any case.
      for (const p of helpPhrases) {
        expect(text.toLowerCase(), `${page}: "${p}" is in a team member's help`).not.toContain(p.toLowerCase());
      }
    });

    it(`on ${page}, still names them for a company admin, so these are the help's real words`, async () => {
      const doc = await loadHelpForRoute(page, "company_admin");
      const text = plain(doc!.markdown).toLowerCase();
      expect(
        helpPhrases.some((p) => text.includes(p.toLowerCase())),
        `${page}: the admin help uses none of ${helpPhrases.join(", ")}`
      ).toBe(true);
    });
  }

  it("never mentions an admin-only tool, on any page", async () => {
    const docs = await loadAllHelpFor("team_member");
    for (const doc of docs) {
      for (const tool of ADMIN_ONLY_TOOLS) {
        expect(plain(doc.markdown), `${doc.slug}: "${tool}" is in a team member's help`).not.toContain(tool);
      }
    }
  });

  it("covers every page it names with a page that exists", async () => {
    for (const { path: page } of ADMIN_ONLY_CONTROLS) {
      const file = path.join(process.cwd(), "src", "app", "(app)", ...page.split("/").filter(Boolean), "page.tsx");
      await expect(fs.access(file)).resolves.toBeUndefined();
    }
  });
});
