import { test, expect, signIn, users, simplifyOn } from "./fixtures";

// The sidebar's sections under the "nav-sections" switch
// (simplification review, change 4). Read-only.
test.describe("sidebar sections", () => {
  test.skip(!simplifyOn("nav-sections"), "the nav-sections switch is off");

  test("a team member sees every page under its section, and the section's pages as tabs", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, users.member());
    await page.goto("/issues");
    const nav = page.getByRole("navigation", { name: "Primary" }).first();
    // Every page one click away: the sections are headings, not doors.
    for (const name of ["Home", "Commitments", "Issues", "Goals & Priorities", "Functional Chart", "People"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible({ timeout: 30_000 });
    }
    await expect(nav.getByRole("link", { name: "Functional Commitments" })).toHaveCount(0);
    const tabs = page.getByRole("navigation", { name: "Work pages" });
    await expect(tabs.getByRole("link", { name: "Issues" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Commitments" }).click();
    await expect(page).toHaveURL(/\/commitments$/);
  });

  test("Ask Aimee is in the sidebar, right after Home", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, users.member());
    const nav = page.getByRole("navigation", { name: "Primary" }).first();
    const links = nav.getByRole("link");
    await expect(nav.getByRole("link", { name: "Ask Aimee", exact: true })).toBeVisible({ timeout: 30_000 });
    const names = (await links.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    expect(names[names.indexOf("Home") + 1]).toBe("Ask Aimee");
    await page.getByTestId("user-menu-trigger").click();
    await expect(page.getByRole("menuitem", { name: "Ask Aimee" })).toHaveCount(0);
  });
});
