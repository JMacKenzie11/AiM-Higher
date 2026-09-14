import { test, expect, signIn, users } from "./fixtures";

// The issue commitment thread, end to end.
//
// An issue is worked through a SEQUENCE of commitments. This walks the
// loop the design is for: land one, get asked whether it solved the
// issue, add another, land that, then resolve from the prompt.
//
// Signed in as the admin fixture, which is a system_admin with a guide
// assignment to the fixture company — it can create issues, own
// commitments and resolve, which is the whole path.

const ISSUE_TITLE = () => `E2E thread issue ${Date.now()}`;

test.describe("issue commitment thread", () => {
  test("land, review, add next, land, resolve", async ({ page }) => {
    await signIn(page, users.admin());

    // Scope in: /issues is company-scoped and the admin has no company
    // of their own.
    await page.goto("/admin/companies");
    await page.getByTestId("scope-into-company").first().click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    await page.goto("/issues");

    // ---- Create the issue ----------------------------------
    const title = ISSUE_TITLE();
    await page.getByLabel(/issue/i).first().fill(title);
    await page.getByRole("button", { name: /add issue/i }).click();
    const row = page.getByRole("article").filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // A brand-new issue has no commitments, so no badge and no
    // prompt — the clause that keeps a question off every empty row.
    await expect(row.getByText(/needs review/i)).toHaveCount(0);

    // ---- First commitment ----------------------------------
    await row.getByPlaceholder(/commitment/i).first().fill("First attempt");
    await row.getByRole("button", { name: /add|save/i }).first().click();
    await expect(row.getByText("First attempt")).toBeVisible({
      timeout: 30_000,
    });

    // ---- Land it, and the review moment appears ------------
    await row.getByRole("button", { name: /kept|done|complete/i })
      .first()
      .click();

    await expect(row.getByText(/did this solve it\?/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(row.getByText(/needs review/i)).toBeVisible();
    // The history marker, now that there is history.
    await expect(row.getByRole("button", { name: /1 done/i })).toBeVisible();

    // ---- Answer "not yet": add the next commitment ---------
    await row.getByRole("button", { name: /add next commitment/i }).click();
    await row.getByPlaceholder(/commitment/i).first().fill("Second attempt");
    await row.getByRole("button", { name: /add|save/i }).first().click();
    await expect(row.getByText("Second attempt")).toBeVisible({
      timeout: 30_000,
    });

    // With work in flight again the prompt stands down. That is the
    // "nothing open" clause doing its job.
    await expect(row.getByText(/did this solve it\?/i)).toHaveCount(0);
    await expect(row.getByText(/needs review/i)).toHaveCount(0);

    // ---- Land the second, and resolve from the prompt ------
    await row.getByRole("button", { name: /kept|done|complete/i })
      .first()
      .click();
    await expect(row.getByText(/did this solve it\?/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(row.getByRole("button", { name: /2 done/i })).toBeVisible();

    await row.getByRole("button", { name: /^resolve issue$/i }).click();

    // Resolved issues leave the open list.
    await expect(
      page.getByRole("article").filter({ hasText: title })
    ).toHaveCount(0, { timeout: 30_000 });
  });

  test("an issue with no history looks exactly as it did", async ({ page }) => {
    // The common case must not gain a marker, a badge or a toggle.
    await signIn(page, users.admin());
    await page.goto("/admin/companies");
    await page.getByTestId("scope-into-company").first().click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await page.goto("/issues");

    const title = ISSUE_TITLE();
    await page.getByLabel(/issue/i).first().fill(title);
    await page.getByRole("button", { name: /add issue/i }).click();
    const row = page.getByRole("article").filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 30_000 });

    await expect(row.getByRole("button", { name: /\d+ done/i })).toHaveCount(0);
    await expect(row.getByText(/needs review/i)).toHaveCount(0);
    await expect(row.getByText(/did this solve it\?/i)).toHaveCount(0);
  });
});
