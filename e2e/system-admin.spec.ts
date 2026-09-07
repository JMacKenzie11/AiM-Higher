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
    const menu = await openRowMenu(newRow);
    await menu.getByRole("menuitem", { name: /delete/i }).click();
    await page.getByTestId("confirm-accept").click();

    await expect(newRow).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("system-admin-row")).toHaveCount(rowsBefore);
  });

  test("the last row's menu is not clipped by the table's scroll container", async ({
    page,
  }) => {
    // The regression from the screenshot on 2026-09-07. The table sits
    // in .tableWrap (overflow-x: auto), and CSS computes overflow-y to
    // auto alongside it, so an absolutely positioned menu was cut off
    // at the container's edge.
    //
    // It only shows on the LAST row: every row above it has enough
    // container below to fit the menu. An earlier version of this
    // spec opened the menu on a freshly added row, which sorts to the
    // top of the list, and passed while the bug was live.
    await signIn(page, users.admin());
    await page.goto("/admin/dashboard");

    const rows = page.getByTestId("system-admin-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // The last row that offers any actions at all. The signed-in
    // admin's own row renders no trigger.
    let target = null;
    for (let i = count - 1; i >= 0; i -= 1) {
      const row = rows.nth(i);
      if ((await row.getByRole("button", { name: /more actions/i }).count()) > 0) {
        target = row;
        break;
      }
    }
    expect(target, "no system admin row offered a menu").not.toBeNull();

    // Into view first, so the assertion measures the menu rather than
    // the consequences of Playwright scrolling to reach it.
    await target!.scrollIntoViewIfNeeded();
    // openRowMenu asserts the menu is fully hit-testable.
    await openRowMenu(target!);
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
