import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// Reordering on /measures, at both levels.
//
// A CRITICAL SUCCESS FACTOR moves within its functional area, by a
// handle between the Owner and the description. A FUNCTIONAL AREA
// moves among its siblings, by a handle beside its name.
//
// ---- WHY THE TWO LEVELS ARE DRIVEN DIFFERENTLY -----------------
//
// The row level uses dnd-kit's keyboard sensor, the same discrete
// pick-up / move / drop the other reorder spec uses and for the same
// reason: simulated mouse movement against dnd-kit is timing
// dependent, the keyboard path is not.
//
// The area level does NOT use that sensor, because it cannot. An
// area is a <tbody>, and dnd-kit's sortableKeyboardCoordinates will
// not navigate between <tbody> droppables — picking one up and
// pressing Down reports "moved over" the area it started on, every
// time, on all six. The pointer drag works (measured: an area moved
// from first to third), so the gesture is sound and only its
// keyboard half is not. Rather than ship a control a keyboard cannot
// reach, the area handle takes Up and Down directly. That is the
// path exercised here, and it is a real user-facing one, not a test
// affordance.
//
// BOTH HALVES RESTORE WHAT THEY MOVED. This runs against a shared
// dev clone and the order is a real column on real rows.

// GEO-SCI, NOT THE SEEDED FIXTURE AND NOT BENSON. Reordering needs
// something to reorder: the fixture company has no measures at all,
// and Benson has exactly one area holding one measure, so both
// correctly render no handles and neither can exercise this. Geo-Sci
// has six areas and several measures in each.
async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Geo-Sci$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

async function openMeasures(page: Page) {
  await page.goto("/measures");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#measures-grid-scroll")).toBeVisible({
    timeout: 30_000,
  });
}

const ROWS = `Array.from(document.querySelectorAll('#measures-grid-scroll tbody th[scope=row]')).map(e => e.textContent.trim())`;
const AREAS = `Array.from(document.querySelectorAll('#measures-grid-scroll tbody th[scope=rowgroup]')).map(e => e.textContent.replace(/[^A-Za-z0-9& ]/g,'').trim())`;

test("a critical success factor keeps its new place in its area", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await openMeasures(page);

  const handles = page.locator(
    '#measures-grid-scroll tbody [title="Drag to reorder"]'
  );
  const count = await handles.count();
  expect(count, "no row handles — nothing to reorder").toBeGreaterThan(1);

  const before = (await page.evaluate(ROWS)) as string[];

  // Pick up the first row, move it one down, drop.
  await handles.first().focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);

  // Reloaded, not just read back: an optimistic order that never
  // reached the database looks identical until the next visit, and
  // the whole point of this is that it persists.
  await openMeasures(page);
  const after = (await page.evaluate(ROWS)) as string[];
  expect(after[0]).toBe(before[1]);
  expect(after[1]).toBe(before[0]);

  // Put it back.
  await handles.nth(1).focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  await openMeasures(page);
  expect((await page.evaluate(ROWS)) as string[]).toEqual(before);
});

test("a functional area keeps its new place among its siblings", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await openMeasures(page);

  const areaHandles = page.locator('[title*="functional area"]');
  const count = await areaHandles.count();
  expect(count, "no area handles — nothing to reorder").toBeGreaterThan(1);

  const before = (await page.evaluate(AREAS)) as string[];

  await areaHandles.first().focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(1800);

  await openMeasures(page);
  const after = (await page.evaluate(AREAS)) as string[];
  expect(after[0]).toBe(before[1]);
  expect(after[1]).toBe(before[0]);

  // Put it back. The handle is found by name, because it has moved.
  await page
    .locator(`[aria-label="Reorder ${before[0]}"]`)
    .focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(1800);
  await openMeasures(page);
  expect((await page.evaluate(AREAS)) as string[]).toEqual(before);
});

test("the save button is just Save", async ({ page }) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await openMeasures(page);
  // "Save this week" was wrong the moment an admin could edit any
  // week, and it was never right for the button's actual scope: it
  // saves whatever you changed.
  await expect(
    page.getByRole("button", { name: /^Save$/ })
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: /save this week/i })
  ).toHaveCount(0);
});
