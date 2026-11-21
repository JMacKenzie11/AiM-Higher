import { test, expect, signIn, users } from "./fixtures";

// The Dashboard (2026-11-21): where a company lands, "Welcome to
// <company>" over two tabs, This week and Dashboard. Read-only.
test("a team member lands on the Dashboard and can switch between its two tabs", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, users.member());
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome to / })).toBeVisible({ timeout: 30_000 });
  const tabs = page.getByRole("navigation", { name: "Dashboard views" });
  await expect(tabs.getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Done this week", { exact: true })).toBeVisible();
  await expect(page.getByText("Honor roll", { exact: true })).toBeVisible();
  await expect(page.getByText("Open commitments", { exact: true })).toBeVisible();
  await expect(page.getByText("Week in review", { exact: true })).toBeVisible();
  await expect(page.locator("#sidebar-drawer")).toHaveAttribute("data-skin", "scoreboard");

  await tabs.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard\?tab=dashboard$/);
  await expect(page.getByText("Follow-Through Rate", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Commitment Clarity", { exact: true })).toHaveCount(0);

  // The old welcome address lands here.
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/dashboard$/);
});
