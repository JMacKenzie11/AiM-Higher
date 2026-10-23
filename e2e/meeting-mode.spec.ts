import { test, expect, signIn, users, simplifyOn } from "./fixtures";

// Meeting mode under the "meeting-mode" switch (simplification review,
// change 5). Walks every step with Next, in the order Jeff runs the
// meeting, and changes nothing: the Headlines field and the check-in
// notes are looked at, not typed in, so no row is written. Numbers,
// Strategy, Commitments and Solve are their whole pages (Jason,
// 2026-10-23), so each is checked for a piece only the page has.
test.describe("meeting mode", () => {
  test.skip(!simplifyOn("meeting-mode"), "the meeting-mode switch is off");

  test("walks the agenda in order and ends on the close", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, users.companyAdmin());
    await page.goto("/meeting");
    await expect(page).toHaveURL(/step=checkin&started=/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Check-in", exact: true })).toBeVisible({ timeout: 30_000 });
    // Two suggested questions, then the notes, which replaced the
    // commitments kept and the factors on target.
    await expect(page.getByRole("heading", { name: "Suggested positive check-in questions" })).toBeVisible();
    await expect(page.locator("ol li").filter({ hasText: "?" })).toHaveCount(2);
    await expect(page.getByRole("textbox", { name: "Check-in notes" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Commitments kept this week" })).toHaveCount(0);
    // Attendance is listed first; looked at, not clicked, so nothing is written.
    await expect(page.getByRole("list", { name: "Who's here" }).getByRole("button").first()).toBeVisible();
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
      if (next === "Numbers") {
        // The Critical Success Factors page's own grid.
        await expect(page.locator("#measures-grid-scroll")).toBeVisible({ timeout: 30_000 });
      }
      if (next === "Strategy") {
        // Goals & Priorities' own toolbar: the quarter switcher, or the
        // line it shows before any quarter exists.
        await expect(page.getByRole("tablist", { name: "Quarter" }).or(page.getByText("No quarters yet"))).toBeVisible({ timeout: 30_000 });
        // A priority opened from the cascade offers the way back to
        // this step. Only when the fixture company has one this quarter.
        const priority = page.locator('a[href^="/plan/priority/"]').first();
        if ((await priority.count()) > 0) {
          await expect(priority).toHaveAttribute("href", /\?from=%2Fmeeting%3Fstep%3Dstrategy/);
          await priority.click();
          const back = page.getByRole("link", { name: /Back to the meeting/ });
          await expect(back).toBeVisible({ timeout: 30_000 });
          await back.click();
          await expect(page).toHaveURL(/\/meeting\?step=strategy&started=/, { timeout: 30_000 });
        } else {
          test.info().annotations.push({ type: "skipped", description: "no priority this quarter, so the way back was not walked" });
        }
      }
      if (next === "Commitments") {
        // Functional Commitments' own filters.
        await expect(page.getByRole("toolbar", { name: "Filters" })).toBeVisible({ timeout: 30_000 });
      }
      if (next === "Solve") {
        await expect(page.getByRole("heading", { name: "Open issues" })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("toolbar", { name: "Filters" })).toBeVisible();
      }
    }
    await expect(page.getByRole("heading", { name: "In this meeting" })).toBeVisible();
    await expect(page.getByText("Mark each one complete as you go")).toBeVisible();
    await expect(page.getByRole("link", { name: "End the meeting" })).toBeVisible();
  });
});
