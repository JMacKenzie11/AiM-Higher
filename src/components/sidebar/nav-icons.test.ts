import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// NO TWO DESTINATIONS SHARE AN ICON.
//
// On the collapsed rail the labels are gone and the icon is the only
// thing distinguishing one row from the next. Six icons were serving
// two or three destinations each — "Issues/Solutions" and "Ask
// Aimee" both drew a sparkle — so the rail repeated the same mark
// and neither instance told you anything.
//
// It is an easy thing to undo by accident. Adding a nav item means
// picking an icon from a union, and the nearest-sounding name is
// usually already taken by something else.
//
// ---- WHY THIS READS THE SOURCE -------------------------------
//
// Sidebar.tsx builds its nav inside a component, from the signed-in
// profile, the company's features and the scoped company. Importing
// it to ask for the list means constructing all of that, and the
// answer would then be one role's menu rather than every item that
// can render. The source carries every item unconditionally, which
// is exactly the set this needs to check.
//
// ---- THE ONE LEGITIMATE REPEAT -------------------------------
//
// The same href in two role-scoped menus keeps one icon on purpose.
// /admin/companies is "Companies" in the system-admin menu and
// "Company settings" in the portfolio one; giving one destination
// two faces is the opposite of what this test is for. So the
// grouping is by HREF, not by label.

const SOURCE = readFileSync(
  join(process.cwd(), "src/components/sidebar/Sidebar.tsx"),
  "utf8"
);

// Each nav entry, as { href, icon }. Entries are written both on one
// line and across several, so this matches the pair inside a single
// object literal rather than assuming a layout.
function navEntries(): { href: string; icon: string; label: string }[] {
  const out: { href: string; icon: string; label: string }[] = [];
  const re =
    /label:\s*"([^"]+)",[\s\S]{0,120}?href:\s*(?:"([^"]+)"|`([^`]+)`),[\s\S]{0,80}?icon:\s*"([a-zA-Z-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SOURCE))) {
    out.push({ label: m[1], href: m[2] ?? m[3], icon: m[4] });
  }
  return out;
}

describe("sidebar icons", () => {
  const entries = navEntries();

  it("finds the nav items at all", () => {
    // A control beside the assertion below, which would otherwise
    // pass on an empty list after any refactor that moved the nav
    // out of this file. E4.
    expect(entries.length).toBeGreaterThan(15);
  });

  it("gives every destination its own icon", () => {
    const byIcon = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!byIcon.has(e.icon)) byIcon.set(e.icon, new Set());
      byIcon.get(e.icon)!.add(e.href);
    }
    const shared = [...byIcon.entries()]
      .filter(([, hrefs]) => hrefs.size > 1)
      .map(([icon, hrefs]) => `${icon}: ${[...hrefs].join(", ")}`);
    expect(shared, "these icons are used by more than one destination").toEqual(
      []
    );
  });

  it("draws every icon it hands out", () => {
    // The union would catch a typo, but not an icon added to the
    // union and never given a case — which renders nothing at all
    // and looks like a spacing bug.
    for (const e of entries) {
      expect(SOURCE, `no drawing for "${e.icon}" (${e.label})`).toContain(
        `case "${e.icon}":`
      );
    }
  });
});
