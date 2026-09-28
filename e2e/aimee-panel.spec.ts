import { test, expect, signIn, users } from "./fixtures";

// Aimee's icon and panel (docs/investigations/aimee-panel.md, Step 1).
// System admins only until Step 3 is merged; everyone else keeps "?".
//
// What the panel promises, as Jason asked for it: on desktop the page
// stays usable beside it; keyboard and screen reader users can get in,
// out and back; on a phone it covers the screen and keeps focus inside.

test.describe("Aimee's panel, desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens beside the page, which stays usable, and Escape hands focus back", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/companies");
    const launcher = page.getByTestId("corner-launcher");
    await expect(launcher).toHaveAttribute("aria-label", "Aimee");

    await launcher.click();
    const panel = page.locator('[data-testid="aimee-panel"]');
    await expect(panel).toBeVisible();
    // A labelled region, not a dialog: nothing hidden from a screen
    // reader, nothing modal.
    await expect(panel).toHaveAttribute("role", "complementary");
    await expect(panel).not.toHaveAttribute("aria-modal", "true");
    await expect(page.getByTestId("drawer-scrim")).toHaveCount(0);
    // Focus lands in the panel, on its first section.
    await expect(page.locator("#aimee-about-this-page")).toBeFocused();
    // The page makes room: its content is not under the panel.
    const box = await panel.boundingBox();
    const heading = page.getByRole("heading", { level: 1 }).first();
    const h = await heading.boundingBox();
    expect(h && box && h.x + h.width <= box.x).toBeTruthy();
    // And its controls still work with the panel open.
    await heading.click();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(launcher).toBeFocused();
  });

  test("Ctrl+. opens it", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/companies");
    await page.keyboard.press("Control+Period");
    await expect(page.locator('[data-testid="aimee-panel"]')).toBeVisible();
  });
});

test.describe("Aimee's panel, phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("covers the screen as a dialog and keeps focus inside", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/companies");
    await page.getByTestId("corner-launcher").click();
    const panel = page.locator('[data-testid="aimee-panel"]');
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(panel).toHaveAttribute("aria-modal", "true");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => !!document.activeElement?.closest('[data-drawer-name="aimee-panel"]')
      );
      expect(inside, `focus left the panel after ${i + 1} Tab(s)`).toBe(true);
    }
  });
});

test("a team member still has the help button, not Aimee", async ({ page }) => {
  await signIn(page, users.member());
  await page.goto("/plan");
  await expect(page.getByTestId("corner-launcher")).toHaveAttribute("aria-label", "Open help");
  await expect(page.locator('[data-testid="aimee-panel"]')).toHaveCount(0);
});
