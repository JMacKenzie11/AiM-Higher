import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Where a function card goes when you click it.
//
// Two answers, and which one you get is the only thing on the chart
// that turns on an edit right:
//
//   * somebody who can edit opens the drawer, and does not navigate;
//   * everybody else follows a link to /chart/function/[id], which
//     is the same detail with nothing editable on it. A button that
//     opens a panel of read-only fields would be a worse version of
//     a page they can bookmark.
//
// ---- WHAT IS PINNED HERE --------------------------------------
//
// Source shape. e2e/chart-function-drawer.spec.ts drives the admin
// half in a browser, because that is where "did it navigate" can
// actually be asked. The team-member half has no fixture chart to
// drive — the seeded company has no functions — so what is checked
// here is that the branch still exists and still has a <Link> in it.
// The failure this catches is somebody deleting the link arm on the
// grounds that nothing was using it.
//
// It also pins the two drawer names. /chart is the only page in the
// app with two drawers mounted at once (the keepMounted "Add
// function" panel is in the DOM even while closed), so
// `data-testid="drawer-panel"` matches two elements there and the
// e2e spec has to tell them apart by name.

const ROOT = process.cwd();
const tree = readFileSync(
  join(ROOT, "src/app/(app)/chart/DraggableTree.tsx"),
  "utf8"
);
const drawer = readFileSync(
  join(ROOT, "src/app/(app)/chart/FunctionDrawer.tsx"),
  "utf8"
);
const addFunction = readFileSync(
  join(ROOT, "src/app/(app)/chart/ChartAddFunction.tsx"),
  "utf8"
);
const page = readFileSync(join(ROOT, "src/app/(app)/chart/page.tsx"), "utf8");
const houseDrawer = readFileSync(
  join(ROOT, "src/components/ui/Drawer.tsx"),
  "utf8"
);

describe("the function card's click target", () => {
  it("opens the drawer for an editor", () => {
    expect(tree).toMatch(/canEdit \?/);
    expect(tree).toMatch(/onClick=\{\(\) => onOpen\(fn\.id\)\}/);
    expect(tree).toMatch(/aria-haspopup="dialog"/);
  });

  it("still links to the detail page for everybody else", () => {
    expect(tree).toMatch(/<Link href=\{`\/chart\/function\/\$\{fn\.id\}`\}/);
  });

  it("draws one card body for both, so they cannot drift apart", () => {
    expect(tree).toMatch(/function FunctionCardBody/);
    expect(tree.match(/styles\.fnTitle/g) ?? []).toHaveLength(1);
  });

  it("opts the trigger out of the pan-and-zoom canvas", () => {
    // Without this the click that opens a panel and the drag that
    // pans the chart are one pointer stream. The drag handle beside
    // it has carried the same class since dnd-kit arrived.
    expect(tree).toMatch(/styles\.fnCardButton\}\s+chart-no-pan/);
  });
});

describe("the chart's two drawers", () => {
  it("are named, because data-testid matches both", () => {
    expect(houseDrawer).toContain("data-drawer-name={name}");
    // Declared in the type AND destructured. Getting only the first
    // renders the attribute as undefined, which is a prop that type-
    // checks, builds, and silently is not there.
    expect(houseDrawer).toMatch(/labelledBy,\s*\n\s*name,\s*\n\}: \{/);
    expect(drawer).toContain('name="chart-function"');
    expect(addFunction).toContain('name="chart-add-function"');
  });

  it("does not keep the function editor mounted", () => {
    // The add form must survive a close: it calls router.push in an
    // effect on success. The editor must NOT, or it spends the fetch
    // showing the function you opened last.
    expect(addFunction).toContain("keepMounted");
    expect(drawer).not.toContain("keepMounted");
  });
});

describe("the chart's admin gate", () => {
  it("asks isAdminForCompany, so an assigned guide is admitted", () => {
    expect(page).toContain("isAdminForCompany(session.profile, companyId)");
    expect(page).not.toMatch(/role === "company_admin"/);
  });
});
