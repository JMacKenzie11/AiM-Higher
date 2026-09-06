import {
  test,
  expect,
  openUserMenu,
  signIn,
  scopeCookie,
  users,
} from "./fixtures";

// A company user's navigation must be completely unaffected by any of
// the scope machinery. They resolve their company from their own
// profile row and never carry a scope cookie.

test.describe("a regular company user", () => {
  test("navigates the app without ever acquiring a scope cookie", async ({
    page,
  }) => {
    await signIn(page, users.member());

    for (const path of ["/dashboard", "/commitments", "/plan", "/people"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByTestId("user-menu-trigger")).toBeVisible();
      expect(await scopeCookie(page), `${path} granted a scope cookie`).toBeNull();
    }
  });

  test("has no way to scope, in or out", async ({ page }) => {
    // They do get a context pill — it names their own company, which
    // is not the same thing as being scoped. What they must never have
    // is a control that changes which tenant they are acting as.
    await signIn(page, users.member());
    await expect(page.getByTestId("scope-into-company")).toHaveCount(0);

    await openUserMenu(page);
    await expect(page.getByTestId("exit-company-scope")).toHaveCount(0);
  });
});
