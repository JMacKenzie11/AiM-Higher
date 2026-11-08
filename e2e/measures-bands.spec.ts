import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";
import type { Page } from "@playwright/test";

// The /measures layout chosen as Option B (Jason, 2026-11-06): a band
// per functional area, one pinned name column with its frequency and
// target under the name, a hover menu in place of the actions column,
// the two open weeks labelled, and a strip saying what is still owed.
//
// READ ONLY. Nothing here types a value, saves an order or confirms an
// archive: the dev clone is shared, and what these check is what the
// page offers, not what the server does with it (measures-reorder
// covers the saves).

async function scopeIn(page: Page, who: "admin" | "member") {
  await signIn(page, who === "admin" ? users.admin() : users.member());
  if (who === "admin") {
    await page.goto("/admin/companies");
    await page
      .getByTestId("scope-into-company")
      .filter({ hasText: new RegExp(`^${FIXTURE_COMPANY_NAME}$`) })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  }
}

async function openMeasures(page: Page) {
  await page.goto("/measures");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#measures-grid-scroll")).toBeVisible({
    timeout: 30_000,
  });
}

const grid = (page: Page) => page.locator("#measures-grid-scroll");

test("each function is a band with its Lead and count, above its measures", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page, "admin");
  await openMeasures(page);

  const band = grid(page)
    .locator("tbody tr", { has: page.locator("[data-area-title]", { hasText: "E2E Operations" }) })
    .first();
  await expect(band).toBeVisible();
  await expect(band).toContainText(/Lead: |No Lead/);
  await expect(band).toContainText("2 measures");

  // One pinned column, and the old ones are gone.
  const head = grid(page).locator("thead");
  // The cell holds its subtitle too ("Frequency, target and source").
  await expect(head.locator("th[data-last-pinned]")).toContainText("Critical success factor");
  await expect(head.locator("th[data-pin]")).toHaveCount(1);
  await expect(head.getByText("Functional Area")).toHaveCount(0);
  await expect(head.getByText("Owner", { exact: true })).toHaveCount(0);
  // The two open weeks are labelled.
  await expect(head.getByText("This week", { exact: true })).toBeVisible();
  await expect(head.getByText("Last week", { exact: true })).toHaveCount(1);
});

test("the name opens the settings drawer, and the row menu works by keyboard", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page, "admin");
  await openMeasures(page);

  const name = "E2E jobs closed per week";
  await grid(page).getByRole("button", { name, exact: true }).click();
  const drawer = page.getByTestId("drawer-panel");
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await expect(drawer).toContainText(name);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  // The ⋯ is reachable by keyboard while hidden at rest: focus shows
  // it, Enter opens on the first item, Escape closes and hands focus
  // back to the trigger.
  const trigger = grid(page).getByRole("button", { name: `More for ${name}` });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Edit settings" })).toBeFocused();
  await expect(menu.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /move up|move down/i })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Edit settings opens the same drawer.
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Edit settings" }).click();
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");

  // Archive asks first; cancelled here.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Archive" }).click();
  const dialog = page.getByRole("dialog", { name: /archive this critical success factor/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("the strip counts what is owed and filters to it", async ({ page }) => {
  test.setTimeout(240_000);
  await scopeIn(page, "admin");
  await openMeasures(page);

  await expect(page.getByText(/^Last week \(.+\): \d+ of \d+ logged$/)).toBeVisible();
  await expect(page.getByText(/^This week \(.+\): \d+ of \d+ entered$/)).toBeVisible();

  const toggle = page.getByRole("button", { name: /^Show only what needs a number \(\d+\)$/ });
  if ((await toggle.count()) === 0) {
    test.info().annotations.push({ type: "note", description: "nothing owed on the fixture today" });
    return;
  }
  const before = await grid(page).locator("[data-measure-name]").count();
  await toggle.click();
  const on = page.getByRole("button", { name: /^Showing only what needs a number/ });
  await expect(on).toHaveAttribute("aria-pressed", "true");
  const owed = Number((await on.textContent())?.match(/\((\d+)\)/)?.[1]);
  await expect(grid(page).locator("[data-measure-name]")).toHaveCount(owed);
  expect(owed).toBeLessThanOrEqual(before);
  // No reordering a filtered handful.
  await expect(grid(page).locator('[title="Drag to reorder"]')).toHaveCount(0);
  await on.click();
  await expect(grid(page).locator("[data-measure-name]")).toHaveCount(before);
});

test("a reader gets names, not buttons, and no row menu", async ({ page }) => {
  test.setTimeout(240_000);
  await scopeIn(page, "member");
  await page.goto("/measures");
  await page.waitForLoadState("networkidle");
  const scroll = grid(page);
  if ((await scroll.count()) === 0) {
    test.info().annotations.push({ type: "note", description: "no measures visible to the member" });
    return;
  }
  await expect(scroll.locator("[data-measure-name]").first()).toBeVisible({ timeout: 30_000 });
  await expect(scroll.locator("button[data-measure-name]")).toHaveCount(0);
  await expect(scroll.getByRole("button", { name: /^More for / })).toHaveCount(0);
});
