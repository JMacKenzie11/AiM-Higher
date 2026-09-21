import { test, expect, signIn, users, openPlanAdd } from "./fixtures";
import type { Page } from "@playwright/test";

// A DISCLOSURE IS SELECTED AS A <summary>, NEVER BY ITS TEXT.
//
// Every add panel has a summary that opens it and a submit button
// that commits it, and since the labels lost their typed "+" the two
// differ only by capitalisation — which getByText ignores. Selecting
// the element type says which one is meant and survives the next
// copy change.

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

// A CASCADE CARD IS FOUND BY ITS OWN TITLE LINK, NEVER BY hasText.
// Every focus-area card carries an "Add goal" form whose parent
// picker lists EVERY focus area by name, so each card's text
// contains every other card's title and `hasText` matches all of
// them. That is silent while a single one exists and a strict-mode
// violation the moment a second does.
function sfaCard(page: Page, title: string) {
  return page
    .locator("details[data-sfa-id]")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

function goalCard(page: Page, title: string) {
  return page
    .locator("details[data-goal-id]")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

// Archive whatever detail page we are on, and wait for the redirect
// that only happens once the write succeeded.
async function archiveFromDetail(page: Page) {
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/, { timeout: 30_000 });
}

// Rows this spec created are real rows on the clone. A run that dies
// halfway leaves them there, and the next run is the only thing that
// will ever tidy them — so it does, before it makes any of its own.
async function sweepLeftovers(page: Page) {
  for (let i = 0; i < 12; i += 1) {
    await page.goto("/plan");
    const leftover = page
      .getByRole("link", { name: /^E2E anchor (SFA|goal) \d+$/ })
      .first();
    if ((await leftover.count()) === 0) return;
    await leftover.click();
    await archiveFromDetail(page);
  }
  throw new Error("Could not clear E2E anchor leftovers from /plan.");
}

test("a back link lands on /plan with the goal revealed", async ({ page }) => {
  test.setTimeout(180_000);
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

  await sweepLeftovers(page);

  // Create a focus area.
  const addSfa = await openPlanAdd(page, "sfa");
  await addSfa.getByLabel("Title").fill(sfaTitle);
  await addSfa.getByRole("button", { name: "Add Focus Area", exact: true }).click();
  const sfa = sfaCard(page, sfaTitle);
  await expect(sfa).toBeVisible({ timeout: 30_000 });

  // Create a goal under it.
  const addGoal = sfa.getByTestId("sfa-add-goal-panel");
  await addGoal.locator("summary").click();
  await addGoal.getByLabel("Title").fill(goalTitle);
  await addGoal.getByRole("button", { name: "Add goal", exact: true }).click();
  const goal = goalCard(page, goalTitle);
  await expect(goal).toBeVisible({ timeout: 30_000 });
  const goalId = await goal.getAttribute("data-goal-id");
  expect(goalId).toBeTruthy();

  // Collapse everything, which persists "closed" for this focus area.
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(goal).toBeHidden();

  // The link a detail page renders.
  await page.goto(`/plan#goal-${goalId}`);
  const goalLink = page.getByRole("link", { name: goalTitle, exact: true });
  await expect(goalLink).toBeVisible({ timeout: 30_000 });
  await expect(goalLink).toBeInViewport();

  // Clean up after ourselves.
  await sweepLeftovers(page);
  await expect(
    page.getByRole("link", { name: /^E2E anchor (SFA|goal) \d+$/ }),
  ).toHaveCount(0);
});
