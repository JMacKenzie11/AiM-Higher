import { test, expect, signIn, users } from "./fixtures";

// The /plan cascade is linkable BY ROW: a detail page's back link
// carries `#goal-<id>`, and landing there opens whatever is
// collapsed above that row before scrolling to it.
//
// The interesting case is the collapsed one, so this test makes it:
// it creates a focus area and a goal, clicks Collapse all (which
// persists "closed" for that focus area in localStorage), and only
// then follows the anchored link. The goal being VISIBLE is the
// assertion that matters — a goal inside a closed focus area is not
// rendered to the reader at all, so visibility proves the ancestor
// was opened rather than merely scrolled past.
//
// Creates its own rows and archives them again, per docs/e2e.md.

test("a back link lands on /plan with the goal revealed", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const sfaTitle = `E2E anchor SFA ${stamp}`;
  const goalTitle = `E2E anchor goal ${stamp}`;

  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^E2E Fixture Co$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  await page.goto("/plan");

  // Create a focus area.
  await page.getByText("+ Add Focus Area").click();
  await page.locator("#sfa-title").fill(sfaTitle);
  await page.getByRole("button", { name: /^Add Focus Area$/ }).click();
  const sfaDetails = page
    .locator("details[data-sfa-id]")
    .filter({ hasText: sfaTitle });
  await expect(sfaDetails).toBeVisible({ timeout: 30_000 });

  // Create a goal under it.
  await sfaDetails.getByText("+ Add annual goal").click();
  await sfaDetails.locator("#goal-title").fill(goalTitle);
  await sfaDetails.getByRole("button", { name: /Add Annual Goal/i }).click();
  const goalDetails = page
    .locator("details[data-goal-id]")
    .filter({ hasText: goalTitle });
  await expect(goalDetails).toBeVisible({ timeout: 30_000 });
  const goalId = await goalDetails.getAttribute("data-goal-id");
  expect(goalId).toBeTruthy();

  // Collapse everything, which persists "closed" for this focus area.
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(goalDetails).toBeHidden();

  // The link a detail page renders.
  await page.goto(`/plan#goal-${goalId}`);
  const goalLink = page.getByRole("link", { name: goalTitle });
  await expect(goalLink).toBeVisible({ timeout: 30_000 });
  await expect(goalLink).toBeInViewport();

  // Clean up: archive the goal, then the focus area.
  await goalLink.click();
  await expect(page).toHaveURL(/\/plan\/goal\//, { timeout: 30_000 });
  await page.getByRole("button", { name: /^Archive$/ }).click();
  await page.getByRole("button", { name: /^Archive$/ }).last().click();
  await expect(page).toHaveURL(/\/plan/, { timeout: 30_000 });

  await page.goto("/plan");
  const sfaLink = page.getByRole("link", { name: sfaTitle });
  if (await sfaLink.isVisible()) {
    await sfaLink.click();
    await page.getByRole("button", { name: /^Archive$/ }).click();
    await page.getByRole("button", { name: /^Archive$/ }).last().click();
  }
});
