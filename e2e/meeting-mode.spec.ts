import { test, expect, signIn, users, simplifyOn } from "./fixtures";

// Meeting mode under the "meeting-mode" switch (simplification review,
// change 5). Walks every step with Next, in the order Jeff runs the
// meeting, and changes nothing: the Headlines field is looked at, not
// typed in, so no headline row is written.
test.describe("meeting mode", () => {
  test.skip(!simplifyOn("meeting-mode"), "the meeting-mode switch is off");

  test("walks the agenda in order and ends on the close", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, users.companyAdmin());
    await page.goto("/meeting");
    await expect(page).toHaveURL(/step=checkin&started=/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Open with this" })).toBeVisible({ timeout: 30_000 });
    for (const next of ["Headlines", "Numbers", "Strategy", "Commitments", "Solve", "Close"]) {
      await page.getByRole("link", { name: `Next: ${next}` }).click();
      await expect(page.getByRole("navigation", { name: "Meeting agenda" }).getByRole("link", { name: next })).toHaveAttribute(
        "aria-current",
        "step",
        { timeout: 30_000 }
      );
      if (next === "Headlines") {
        // One block per functional area, each with this week's field.
        // The fixture company has at least "E2E Led Function".
        const blocks = page.getByRole("region", { name: /headline/i });
        await expect(blocks.first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("textbox", { name: /^This week, E2E Led Function/ })).toBeVisible();
      }
      if (next === "Solve") {
        await expect(page.getByRole("heading", { name: "Open issues" })).toBeVisible({ timeout: 30_000 });
      }
    }
    await expect(page.getByRole("heading", { name: "In this meeting" })).toBeVisible();
    await expect(page.getByText("Mark each one complete as you go")).toBeVisible();
    await expect(page.getByRole("link", { name: "End the meeting" })).toBeVisible();
  });
});
