import { test, expect, signIn, users, simplifyOn } from "./fixtures";

// My week: a team member's Home under the "my-week" switch
// (simplification review, change 3). Read-only: nothing is added.
test.describe("my week", () => {
  test.skip(!simplifyOn("my-week"), "the my-week switch is off");

  test("a team member lands on their own week, with the company view one link away", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, users.member());
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: /^Your week/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Your commitments" })).toBeVisible();
    await page.getByRole("link", { name: "How the company’s week is going" }).click();
    await expect(page).toHaveURL(/\/dashboard\?view=company$/);
    await expect(page.getByRole("heading", { level: 1, name: /^Your week/ })).toHaveCount(0);
  });

  test("an admin keeps Week in Review", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, users.companyAdmin());
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: /^Your week/ })).toHaveCount(0, { timeout: 30_000 });
  });
});
