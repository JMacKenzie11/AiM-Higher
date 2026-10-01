import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";
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

// THE FIXTURE COMPANY, never a copy of a client's. Reordering needs
// something to reorder, so seed:e2e gives the fixture two areas (E2E
// Operations, E2E Sales) with two measures each, and resets their
// order on every run. This used to run against Geo-Sci's copy, which
// had enough to reorder and was a client's data.
async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: new RegExp(`^${FIXTURE_COMPANY_NAME}$`) })
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

// Press the key that drops (or moves) and wait for the reorder's save to
// answer, not for a length of time. Navigating before it lands reads the
// old order. A fixed 1.5 seconds was too short in a full run on
// 2026-09-30: the save took 2.4 seconds on a freshly started dev server,
// and the page reloaded at 1.5.
async function pressAndSave(page: Page, key: string) {
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined,
    { timeout: 30_000 }
  );
  await page.keyboard.press(key);
  const response = await saved;
  expect(response.ok(), "the reorder save failed").toBe(true);
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
  await pressAndSave(page, "Space");

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
  await pressAndSave(page, "Space");
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
  await pressAndSave(page, "ArrowDown");

  await openMeasures(page);
  const after = (await page.evaluate(AREAS)) as string[];
  expect(after[0]).toBe(before[1]);
  expect(after[1]).toBe(before[0]);

  // Put it back. The handle is found by name, because it has moved.
  await page
    .locator(`[aria-label="Reorder ${before[0]}"]`)
    .focus();
  await pressAndSave(page, "ArrowUp");
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
