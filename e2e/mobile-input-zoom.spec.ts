import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// Scoped into a company that actually HAS measures, because the
// probe below refuses to pass on a page with no controls, and the
// seeded fixture company has none. Benson Seafood is the company the
// rest of the suite scopes into for the same reason.
async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

// NO FORM CONTROL MAY BE SMALLER THAN 16px ON A PHONE.
//
// ---- WHAT THIS IS ACTUALLY TESTING ------------------------------
//
// iOS Safari zooms the whole page when a form control whose
// font-size is under 16px takes focus. Not configurable, not a bug:
// Safari has decided the text is too small to type into.
//
// The damage is what zooming does to fixed positioning. A zoomed
// page keeps laying `position: fixed` out against the LAYOUT
// viewport while the screen shows a smaller VISUAL viewport, so a
// full-width fixed panel no longer fits and Safari scrolls it to
// keep the focused input in view. The panel's left edge, which is
// where its labels are, goes off the side — and Safari KEEPS the
// zoom after the keyboard closes, so the page stays broken until a
// reload or a pinch.
//
// Reported as "the panel doesn't render properly on mobile", with a
// screenshot of the add drawer reading "CTIONAL AREA" and "TICAL
// SUCCESS FACTOR". It survived two rounds of fixing the page's
// horizontal overflow, which was a real and separate bug, because
// nothing about it is visible unless a control has focus.
//
// ---- WHY IT IS HERE AND NOT IN VITEST ---------------------------
//
// The thing that matters is the COMPUTED font-size of a rendered
// control at a phone viewport. A unit test can only assert that some
// CSS text exists, which says nothing about whether it won: these
// are CSS modules, and a class selector beats a bare element one. At
// the time of writing, EVERY control in the app was under 16px —
// 14px on most forms, 13px in the grid and on /commitments — so the
// floor has to out-specify all of them, and only a browser knows if
// it did.
//
// Run it against a build without the floor in globals.css and this
// reports around eighty violations, including both fields on the
// sign-in page.

const PROBE = `(() => {
  // The controls Safari zooms for: anything that shows text. A
  // checkbox has none, so it never triggers it and 16px would only
  // change its box for nothing.
  const SKIP = ["checkbox","radio","range","hidden","submit","button","file","color"];
  const bad = [];
  const all = document.querySelectorAll("input,select,textarea");
  for (const el of Array.from(all)) {
    const t = el.tagName.toLowerCase();
    const ty = el.type || "";
    const zooms = t === "select" || t === "textarea" || (t === "input" && SKIP.indexOf(ty) === -1);
    if (!zooms) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) bad.push(t + "[" + ty + "]" + (el.name ? "#" + el.name : "") + "=" + fs + "px");
  }
  return { checked: all.length, under16: bad };
})()`;

type Probe = { checked: number; under16: string[] };

// A zero is not a pass until a nonzero was available: a page that
// rendered no controls at all would report clean. So every
// assertion below also proves it had something to look at.
async function expectNoZoomTriggers(page: Page, where: string) {
  const result = (await page.evaluate(PROBE)) as Probe;
  expect(result.checked, `${where} rendered no form controls at all`).toBeGreaterThan(0);
  expect(result.under16, `${where}: these would zoom iOS Safari on focus`).toEqual([]);
}

test("the sign-in form does not zoom a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/sign-in");
  await expectNoZoomTriggers(page, "/sign-in");
});

test("no form control on a phone is small enough to zoom Safari", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await scopeIn(page);

  for (const path of ["/measures", "/plan", "/commitments", "/people"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoZoomTriggers(page, path);
  }
});

test("the measures add drawer fits the screen, and cannot zoom it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await scopeIn(page);
  await page.goto("/measures");
  await page.waitForLoadState("networkidle");

  // Not guarded with test.skip: scoped in as a system_admin there IS
  // an authoring seat, and if this button has gone the test should
  // say so rather than quietly pass.
  const add = page.getByRole("button", {
    name: /add a critical success factor/i,
  });
  await expect(add.first()).toBeVisible({ timeout: 30_000 });
  await add.first().click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await expectNoZoomTriggers(page, "the add drawer");

  // And the panel itself starts at the left edge and ends at the
  // right one. `right: 0` resolves against the DOCUMENT's width, so
  // any horizontal page overflow pushes a fixed panel off-screen —
  // the other half of the same report, fixed separately in #242.
  // POLLED, NOT READ ONCE. The drawer slides in on a transform, and
  // `toBeVisible` resolves at the START of that animation — reading
  // the box there reported x=223 on a 393px viewport, which is the
  // panel mid-slide rather than anything wrong with it.
  await expect
    .poll(async () => Math.round((await drawer.boundingBox())!.x), {
      timeout: 10_000,
    })
    .toBe(0);
  const box = (await drawer.boundingBox())!;
  const vw = await page.evaluate("document.documentElement.clientWidth");
  expect(Math.round(box.width)).toBe(vw);
});
