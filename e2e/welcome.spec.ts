import { test, expect, signIn, users } from "./fixtures";

// /welcome (Jason, 2026-11-20): reached by typing the address, and the
// only page whose sidebar wears the Scoreboard design.
test("the welcome page opens by its address, and only it changes the sidebar", async ({ page }) => {
  await signIn(page, users.member());
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome to / })).toBeVisible();
  await expect(page.getByText(/^Good to see you, .+\.$/)).toBeVisible();
  await expect(page.getByText("Honor roll", { exact: true })).toBeVisible();
  await expect(page.getByText("Open commitments", { exact: true })).toBeVisible();
  await expect(page.locator("#sidebar-drawer")).toHaveAttribute("data-skin", "scoreboard");

  // Nothing in the sidebar leads here.
  await expect(page.locator('#sidebar-drawer a[href="/welcome"]')).toHaveCount(0);

  await page.goto("/commitments");
  await expect(page.locator("#sidebar-drawer")).not.toHaveAttribute("data-skin", /.+/);
});
