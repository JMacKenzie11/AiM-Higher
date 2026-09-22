import { test, expect, signIn, users } from "./fixtures";

// The Agent Hub's two write paths, each walked in a browser and each
// put back the way it was found.
//
// These run against the dev clone, so every test here restores what
// it changed. A rename that leaked would show up on somebody else's
// screen as the product having been renamed, which is exactly the
// blast radius this page has and the reason it is system-admin only.

const SLUG = "ask-better-questions";

// The slug is on the row element itself, so this addresses the row
// directly. Re-resolved after every write rather than held, because
// router.refresh() replaces the node.
function rowFor(page: import("@playwright/test").Page) {
  return page.locator(`[data-agent-slug="${SLUG}"]`);
}

test.describe("Agent Hub", () => {
  test("renames an agent, sees it in the picker, and renames it back", async ({
    page,
  }) => {
    const marker = `E2E Renamed ${Date.now()}`;

    await signIn(page, users.admin());
    await page.goto("/admin/agents");

    const row = rowFor(page);
    await expect(row).toBeVisible();
    // Captured rather than hardcoded: the seeded title is a product
    // string and this test must not be the thing that pins it.
    const original = (await row.locator("p").first().innerText()).trim();

    await row.getByRole("button", { name: /^edit$/i }).click();
    const nameField = row.getByLabel(/^name$/i);
    await nameField.fill(marker);
    await row.getByRole("button", { name: /^save$/i }).click();

    await expect(rowFor(page)).toContainText(marker, { timeout: 15_000 });

    // The edit has to reach the surface people actually use, not
    // just the screen that made it. This is the whole point of the
    // merge layer, and the failure it is guarding against is a
    // rename that shows only in the Hub.
    await page.goto("/ask-aimee");
    await expect(page.getByText(marker).first()).toBeVisible({
      timeout: 15_000,
    });

    // ---- put it back ----
    await page.goto("/admin/agents");
    const again = rowFor(page);
    await again.getByRole("button", { name: /^edit$/i }).click();
    await again.getByLabel(/^name$/i).fill(original);
    await again.getByRole("button", { name: /^save$/i }).click();
    await expect(rowFor(page)).toContainText(original, { timeout: 15_000 });
  });

  test("limits an agent to one company and opens it up again", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/agents");

    const row = rowFor(page);
    await expect(row).toBeVisible();
    const summary = row.getByTestId("agent-hub-access-summary");
    // Starts with no allowlist, which reads as every company.
    await expect(summary).not.toContainText(/compan(y|ies)/i);

    await row.getByRole("button", { name: /^access$/i }).click();
    const firstCompany = row.locator('input[type="checkbox"]').last();
    await firstCompany.check();
    await row.getByRole("button", { name: /^save$/i }).click();

    await expect(rowFor(page).getByTestId("agent-hub-access-summary")).toContainText(
      /1 company/i,
      { timeout: 15_000 }
    );

    // ---- put it back ----
    const back = rowFor(page);
    await back.getByRole("button", { name: /^access$/i }).click();
    await back.locator('input[type="checkbox"]').last().uncheck();
    await back.getByRole("button", { name: /^save$/i }).click();
    await expect(
      rowFor(page).getByTestId("agent-hub-access-summary")
    ).not.toContainText(/compan(y|ies)/i, { timeout: 15_000 });
  });

  test("refuses to hide a category that still holds agents", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/agents");

    const categories = page.getByTestId("agent-hub-categories");
    const populated = categories
      .getByTestId("agent-hub-category-row")
      .filter({ hasText: /[1-9]\d* agents?/ })
      .first();
    await populated.getByRole("button", { name: /^hide$/i }).click();

    // A refusal, in a sentence, with the thing to do next in it.
    // Not a thrown error and not a silent no-op.
    await expect(page.getByTestId("agent-hub-message")).toContainText(
      /move its agents/i,
      { timeout: 15_000 }
    );
    // And the category is still there, still showing its agents.
    await expect(populated).toBeVisible();
  });

  test("is closed to a team member", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/admin/agents");
    // requireRole redirects rather than rendering; what matters is
    // that the editor never appears.
    await expect(page.getByTestId("agent-hub-agents")).toHaveCount(0);
  });
});
