import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// Adding a function builds the whole box in the panel.
//
// It used to submit three fields and redirect to the new function's
// page, because a responsibility needs a function_id and there was
// no function until you had submitted. So naming a function cost you
// the chart: you left it, typed two lines, and came back to a canvas
// reset to where it started.
//
// What is pinned here is what a unit test structurally cannot see:
//
//   * the responsibilities typed before the function existed are on
//     the card afterwards, which is the whole feature;
//   * the URL never leaves /chart, which is the half that regresses
//     quietly the moment somebody re-adds a router.push;
//   * the panel closes itself, and opens blank next time. It is
//     keepMounted, so its React state survives the close and the
//     second function would otherwise inherit the first one's list.

async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

const panelOf = (page: Page) =>
  page
    .getByTestId("drawer-panel")
    .and(page.locator('[data-drawer-name="chart-add-function"]'));

test("a function and its responsibilities are added in one go", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.goto("/chart");

  const panel = panelOf(page);
  const title = `E2E add ${Date.now()}`;

  await page.getByTestId("add-function-button").click();
  await expect(panel).toBeVisible({ timeout: 30_000 });

  await panel.getByLabel(/function title/i).fill(title);

  // The baseline row is shown before the function exists. A trigger
  // writes it either way, and a list that starts empty here and
  // arrives with a row in it reads as a bug.
  await expect(panel.getByText("Lead, Track, Decide")).toBeVisible();

  const draft = panel.getByLabel("New responsibility");
  await draft.fill("Run the probe");
  await draft.press("Enter");
  await draft.fill("Read the result");
  await draft.press("Enter");

  // Enter added rows and did NOT submit. A half-typed responsibility
  // followed by Enter creating the function is the shape of a box you
  // then have to go and fix.
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Run the probe")).toBeVisible();

  // One typed and left in the draft box is dropped, not saved: it was
  // never committed to the list.
  await draft.fill("Never committed");

  await panel.getByRole("button", { name: /^Add function$/ }).click();

  // ---- Closes onto the chart, does not navigate ---------------
  await expect(panel).toBeHidden({ timeout: 30_000 });
  expect(new URL(page.url()).pathname, "still on the chart").toBe("/chart");

  // ---- The box is drawn, with its responsibilities ------------
  const card = page
    .getByTestId("function-card-button")
    .filter({ hasText: title });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Lead, Track, Decide");
  await expect(card).toContainText("Run the probe");
  await expect(card).toContainText("Read the result");
  await expect(card).not.toContainText("Never committed");

  // ---- Opens blank the second time ----------------------------
  await page.getByTestId("add-function-button").click();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByLabel(/function title/i)).toHaveValue("");
  await expect(panel.getByText("Run the probe")).toBeHidden();

  // ---- Clean up, through the UI -------------------------------
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });
  await card.click();
  const fnPanel = page
    .getByTestId("drawer-panel")
    .and(page.locator('[data-drawer-name="chart-function"]'));
  await expect(fnPanel).toBeVisible({ timeout: 30_000 });
  await fnPanel.getByRole("button", { name: /delete function/i }).click();
  await page.getByTestId("confirm-accept").click();
  await expect(card).toBeHidden({ timeout: 30_000 });
});
