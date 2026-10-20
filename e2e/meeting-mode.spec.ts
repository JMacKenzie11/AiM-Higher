import { test, expect, signIn, users, simplifyOn } from "./fixtures";

// Meeting mode under the "meeting-mode" switch (simplification review,
// change 5). Walks every step with Next and changes nothing.
test.describe("meeting mode", () => {
  test.skip(!simplifyOn("meeting-mode"), "the meeting-mode switch is off");

  test("walks the agenda in order and ends on the close", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, users.companyAdmin());
    await page.goto("/meeting");
    await expect(page).toHaveURL(/step=checkin&started=/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Open with this" })).toBeVisible({ timeout: 30_000 });
    for (const next of ["Numbers", "Strategy", "Solve", "Commitments", "Close"]) {
      await page.getByRole("link", { name: `Next: ${next}` }).click();
      await expect(page.getByRole("navigation", { name: "Meeting agenda" }).getByRole("link", { name: next })).toHaveAttribute(
        "aria-current",
        "step",
        { timeout: 30_000 }
      );
    }
    await expect(page.getByRole("heading", { name: "In this meeting" })).toBeVisible();
    await expect(page.getByRole("link", { name: "End the meeting" })).toBeVisible();
  });
});
