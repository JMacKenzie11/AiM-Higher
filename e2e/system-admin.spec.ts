import { test, expect, openRowMenu, signIn, users } from "./fixtures";

// System admins belong to no company, so no roster in the app shows
// them: /people scopes every query by company_id and a company-less
// profile matches none of them. Adding one appeared to work and then
// the person was nowhere. The platform dashboard is the one surface
// that lists them, and this walks the whole loop in a browser: add,
// see the row, delete, see it gone.
//
// The account created here is disposable and is deleted by the test
// itself. It is given a unique address per run so a failed run leaves
// no landmine for the next one.

test.describe("system admins on the platform dashboard", () => {
  test("adds one, lists it, and deletes it again", async ({ page }) => {
    const email = `e2e-sysadmin-${Date.now()}@aims-institute.com`;

    await signIn(page, users.admin());
    await page.goto("/admin/dashboard");

    const list = page.getByTestId("system-admin-list");
    await expect(list).toBeVisible();

    // The signed-in admin is on the list, and has no Delete on
    // themselves: the action refuses it, so the menu must not offer it.
    const rowsBefore = await page.getByTestId("system-admin-row").count();
    expect(rowsBefore).toBeGreaterThan(0);

    // ---- add ----
    const form = page.getByTestId("system-admin-form");
    await form.getByLabel(/full name/i).fill("E2E Disposable Admin");
    // Anchored: an unanchored /email/i also matches the "Send invite
    // email now" checkbox.
    await form.getByLabel(/^email$/i).fill(email);
    // Leaves "Send invite email now" unchecked, so no mail is sent to
    // a throwaway address.
    await page.getByTestId("add-system-admin").click();

    const newRow = page
      .getByTestId("system-admin-row")
      .filter({ hasText: email });
    await expect(newRow).toBeVisible({ timeout: 15_000 });
    // Created without an invite email, so it sits unaccepted.
    await expect(newRow).toContainText(/invite not accepted/i);
    await expect(page.getByTestId("system-admin-row")).toHaveCount(
      rowsBefore + 1
    );

    // ---- delete ----
    await openRowMenu(newRow);
    await newRow.getByRole("menuitem", { name: /delete/i }).click();
    await page.getByTestId("confirm-accept").click();

    await expect(newRow).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("system-admin-row")).toHaveCount(rowsBefore);
  });

  test("offers no delete on the signed-in admin's own row", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/dashboard");

    const ownRow = page
      .getByTestId("system-admin-row")
      .filter({ hasText: "(you)" });
    await expect(ownRow).toHaveCount(1);

    // No actions apply to your own row, so there is no menu at all.
    // Asserting the absence of the trigger rather than the absence of
    // a Delete item: the earlier version of this test passed while the
    // menu was never opening, which proved nothing.
    await expect(
      ownRow.getByRole("button", { name: /more actions/i })
    ).toHaveCount(0);
  });
});
