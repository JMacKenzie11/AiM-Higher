import { test, expect, signIn, users } from "./fixtures";

// A priority whose goal was archived says so.
//
// /plan buckets it into Standalone Quarterly Priorities — that has
// always been deliberate, so archiving a goal does not make its
// priorities vanish — but until this it looked identical to a row
// nobody had ever linked. And its own page linked back to the
// archived goal without saying it was archived, which #274 removed;
// this is the other half, saying why the link is gone.
//
// COUNTS ARE NOT HARDCODED. The first version of this asserted "3
// chips", a number read off PRODUCTION while the suite runs against
// the dev clone, which had 4. The number is a property of whatever
// somebody last archived, not of the feature. What is asserted here
// is the relationship: rows that lost a parent carry it, rows that
// never had one do not.

test("a priority whose goal was archived says so", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  await page.goto("/plan", { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname, "must be on /plan").toBe("/plan");

  const standalone = page.getByRole("region", {
    name: /Standalone Quarterly/i,
  });
  await expect(standalone).toBeVisible({ timeout: 30_000 });

  const rows = standalone.locator("li");
  const withChip = rows.filter({ hasText: "Original goal archived" });
  const rowCount = await rows.count();
  const chipCount = await withChip.count();

  // Not every standalone row, and not none of them. Both ways this
  // can be wrong produce a number at one of those two extremes: a
  // chip derived from the wrong field lands on all of them, and a
  // chip that never renders lands on none.
  expect(chipCount, "some standalone rows lost a parent").toBeGreaterThan(0);
  expect(chipCount, "not every standalone row lost one").toBeLessThan(rowCount);

  // Benson's "Just do -" rows were typed in with no parent at all.
  // They are the control: standalone from birth, nothing to explain.
  const neverLinked = rows.filter({ hasText: "Just do -" });
  await expect(neverLinked.first()).toBeVisible();
  await expect(
    neverLinked.filter({ hasText: "Original goal archived" })
  ).toHaveCount(0);

  // ---- and it follows through to the priority's own page ---------
  await withChip.first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/plan\/priority\//, { timeout: 30_000 });

  await expect(page.getByText("Original goal archived").first()).toBeVisible();
  // The link #274 removed stays removed. Saying the goal is archived
  // and then linking to it would be worse than either alone.
  await expect(page.getByRole("link", { name: /^Goal:/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Back to goal/i })).toHaveCount(0);
});
