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
    await expect(
      row.getByRole("button", { name: /show 1 finished commitment/i })
    ).toBeVisible();

    // ---- Answer "not yet": add the next commitment ---------
    // No "add next" button any more: the add line is already there,
    // at the end of the thread, whatever state the issue is in.
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
    await expect(
      row.getByRole("button", { name: /show 2 finished commitments/i })
    ).toBeVisible();

    await row.getByRole("button", { name: /^resolve issue$/i }).click();

    // Resolved issues leave the open list.
    await expect(
      page.getByRole("article").filter({ hasText: title })
    ).toHaveCount(0, { timeout: 30_000 });
  });

  test("a second commitment can be added while the first is still open", async ({
    page,
  }) => {
    // THE GAP THIS SPEC MISSED THE FIRST TIME. The original walk only
    // added a second commitment through the review prompt, which
    // appears once everything has landed — so "add another while one
    // is open" was never exercised, and it was not possible.
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

    // First commitment, left OPEN.
    await row.getByPlaceholder(/commitment/i).first().fill("First, still open");
    await row.getByRole("button", { name: /add|save/i }).first().click();
    await expect(row.getByText("First, still open")).toBeVisible({
      timeout: 30_000,
    });

    // No opener to click: the add line is always the last line of the
    // thread, so a second commitment is typed in the same place the
    // first was.
    await row.getByPlaceholder(/commitment/i).last().fill("Second, alongside");
    await row.getByRole("button", { name: /add|save/i }).last().click();

    // Both are on the issue, and neither displaced the other.
    await expect(row.getByText("First, still open")).toBeVisible({
      timeout: 30_000,
    });
    await expect(row.getByText("Second, alongside")).toBeVisible();

    // AND BOTH SURVIVE A RELOAD. The original spec asserted only what
    // was on screen straight after adding, which passed while the
    // first commitment was in fact being folded into a collapsed
    // panel — visible only because the panel happened to be open.
    // Navigating away and back is what exposed it.
    await page.goto("/dashboard");
    await page.goto("/issues");
    const reloaded = page.getByRole("article").filter({ hasText: title });
    await expect(reloaded.getByText("First, still open")).toBeVisible({
      timeout: 30_000,
    });
    await expect(reloaded.getByText("Second, alongside")).toBeVisible();

    // Both are ordinary lines in the same list; neither is hidden
    // behind a control.
    await expect(
      reloaded.getByRole("button", { name: /finished commitment/i })
    ).toHaveCount(0);
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

    // No done-count marker, no badge, no prompt. A brand-new issue
    // with no commitment at all also gets no thread opener — the row
    // already carries an inline add form, and two would be one too
    // many.
    await expect(
      row.getByRole("button", { name: /finished commitment/i })
    ).toHaveCount(0);
    await expect(row.getByText(/needs review/i)).toHaveCount(0);
    await expect(row.getByText(/did this solve it\?/i)).toHaveCount(0);
    // The add line is always present — that is the point of the
    // uniform model — so the assertion is that nothing EXTRA appears.
    await expect(row.getByPlaceholder(/commitment/i)).toHaveCount(1);
  });
});
