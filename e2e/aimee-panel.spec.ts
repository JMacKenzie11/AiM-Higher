import { test, expect, signIn, users } from "./fixtures";

// Aimee's icon and panel (docs/investigations/aimee-panel.md, Steps 1
// and 3), for everyone, in place of the "?".
//
// What the panel promises, as Jason asked for it: on desktop the page
// stays usable beside it; keyboard and screen reader users can get in,
// out and back; on a phone it covers the screen and keeps focus inside.

test.describe("Aimee's panel, desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens beside the page, which stays usable, and Escape hands focus back", async ({ page }) => {
    // A company page: with no company chosen there is no conversation,
    // so nothing for focus to land in.
    await signIn(page, users.member());
    await page.goto("/plan");
    const launcher = page.getByTestId("corner-launcher");
    // "Aimee", or "Aimee, 1 waiting for you" when something is in For you
    // (the member is the fixture's AiMS champion, so a debrief can be).
    await expect(launcher).toHaveAttribute("aria-label", /^Aimee(, \d+ waiting for you)?$/);

    // The page's own title, measured before and after.
    const pageBefore = await page.getByRole("heading", { level: 1 }).first().boundingBox();
    await launcher.click();
    const panel = page.locator('[data-testid="aimee-panel"]');
    await expect(panel).toBeVisible();
    // A labelled region, not a dialog: nothing hidden from a screen
    // reader, nothing modal.
    await expect(panel).toHaveAttribute("role", "complementary");
    await expect(panel).not.toHaveAttribute("aria-modal", "true");
    await expect(page.getByTestId("drawer-scrim")).toHaveCount(0);
    // Focus lands in the message box once the conversation has loaded.
    await expect(panel.getByPlaceholder("Ask Aimee…")).toBeFocused({ timeout: 30_000 });
    // No "About this page": everything goes through Aimee.
    await expect(panel.getByText("About this page")).toHaveCount(0);
    // It floats over the page (Jason, 2026-09-29): the page keeps its
    // width, and the panel sits over its right-hand edge.
    const box = await panel.boundingBox();
    const pageAfter = await page.getByRole("heading", { level: 1 }).first().boundingBox();
    expect(pageAfter?.x).toBe(pageBefore?.x);
    expect(pageAfter?.width).toBe(pageBefore?.width);
    // Pinned to the window's right edge, over the page.
    const viewport = page.viewportSize()!;
    expect(box && Math.round(box.x + box.width)).toBe(viewport.width);
    const heading = page.getByRole("heading", { level: 1 }).first();
    // And its controls still work with the panel open.
    await heading.click();

    // Escape on the page belongs to the page: the panel stays.
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();

    // Escape inside the panel closes it and hands focus back.
    await panel.getByPlaceholder("Ask Aimee…").focus();
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

test.describe("the conversation in the panel", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Needs 0240 on the database the dev server reads (origin, and the
  // panel's counting table). Sends nothing to the model.
  test("a team member gets Aimee, with this page's help and a conversation", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/plan");
    const launcher = page.getByTestId("corner-launcher");
    // "Aimee", or "Aimee, 1 waiting for you" when something is in For you
    // (the member is the fixture's AiMS champion, so a debrief can be).
    await expect(launcher).toHaveAttribute("aria-label", /^Aimee(, \d+ waiting for you)?$/);
    await launcher.click();
    const panel = page.locator('[data-testid="aimee-panel"]');

    // The panel reopens this person's last panel conversation, and an
    // earlier spec (aimee-panel-memory) leaves one with turns in it.
    // Start fresh when that happens, so this checks a new one.
    await expect(panel.getByPlaceholder("Ask Aimee…")).toBeVisible({ timeout: 30_000 });
    const fresh = panel.getByRole("button", { name: "New conversation" });
    if (await fresh.isVisible()) {
      const before = await panel.locator("[data-conversation-id]").getAttribute("data-conversation-id");
      await fresh.click();
      await expect(panel.locator("[data-conversation-id]")).not.toHaveAttribute("data-conversation-id", before ?? "", { timeout: 30_000 });
    }

    // Aimee's greeting, and no "About this page".
    await expect(panel.getByText(/Ask me about anything on this page, or anything on your mind\./)).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("About this page")).toHaveCount(0);

    // The conversation: a composer inside the panel, not the page's.
    const composer = panel.getByPlaceholder("Ask Aimee…");
    await expect(composer).toBeVisible({ timeout: 30_000 });
    // No "New conversation" while this one is empty: it is already new.
    await expect(panel.getByRole("button", { name: "New conversation" })).toHaveCount(0);

    // Moving to another page keeps the panel and its conversation.
    await composer.fill("a draft that should survive navigation");
    // The sidebar's link, not the phone menu's copy of it.
    await page.locator('a[href="/scorecard"]:visible').first().click();
    await expect(page).toHaveURL(/\/scorecard/);
    await expect(panel).toBeVisible();
    await expect(composer).toHaveValue("a draft that should survive navigation");
  });

  test("the corner button stays clear of the panel's Send button", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/plan");
    await page.getByTestId("corner-launcher").click();
    const panel = page.locator('[data-testid="aimee-panel"]');
    await expect(panel.getByPlaceholder("Ask Aimee…")).toBeVisible({ timeout: 30_000 });
    const button = await page.getByTestId("corner-launcher").boundingBox();
    const box = await panel.boundingBox();
    expect(button && box && button.x + button.width <= box.x).toBeTruthy();
  });
});
