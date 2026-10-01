import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// AIMEE'S PANEL SWITCHED OFF, the way production runs until Jason turns
// AIMEE_PANEL_FOR_EVERYONE on (src/lib/aimee/panel-audience.ts). Runs on
// its own server with the switch unset: project "panel-off" in
// playwright.config.ts, port 3202.
//
// What a team member must still have: the "?" help button, and a Guide
// invitation in the bell that opens its conversation. What they must not
// have: Aimee's panel.
//
// Opening the invitation marks it read, and only the seed can raise
// another, so this spec needs a fresh seed and leaves the next spec that
// opens it needing one too (docs/e2e.md).

// The bell sits where `next dev` parks its dev-tools badge, which
// swallows clicks there. It does not exist in a production build.
async function ignoreDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { pointer-events: none !important; }" });
}

test.describe.configure({ mode: "serial" });

test.describe("Aimee's panel, switched off", () => {
  test("a team member gets the ? help button and no panel", async ({ page }) => {
    // The first request on this server compiles the app.
    test.setTimeout(300_000);
    await signIn(page, users.member());
    await page.goto("/dashboard", { timeout: 180_000 });

    const launcher = page.getByTestId("corner-launcher");
    await expect(launcher).toBeVisible({ timeout: 120_000 });
    await expect(launcher).toHaveAccessibleName(/open help/i);
    await expect(page.getByRole("button", { name: /^aimee$/i })).toHaveCount(0);

    await launcher.click();
    await expect(launcher).toHaveAccessibleName(/close help/i);
    await expect(page.locator('[data-testid="aimee-panel"]')).toHaveCount(0);
  });

  test("a Guide invitation is in the bell and opens its conversation", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, users.member());
    await page.goto("/dashboard", { timeout: 120_000 });
    await ignoreDevOverlay(page);

    await page.getByRole("button", { name: /notifications \(/i }).click({ timeout: 60_000 });
    const item = page.locator('a[href^="/guide/nudge/"]').first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 120_000 });
  });
});
