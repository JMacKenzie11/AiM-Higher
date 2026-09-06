import {
  test,
  expect,
  openUserMenu,
  signIn,
  scopeCookie,
  users,
} from "./fixtures";

// Scope-in and scope-out, through the UI, as an operator does it.

test.describe("scoping into a company", () => {
  test("the button scopes in and lands on the company dashboard", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/hq");

    expect(await scopeCookie(page)).toBeNull();

    const control = page.getByTestId("scope-into-company").first();
    const companyId = await control.getAttribute("data-company-id");
    await control.click();

    // The action hard-navigates, so wait for the destination rather
    // than a client transition.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    expect(await scopeCookie(page)).toBe(companyId);

    // The app agrees it is acting as that company. The way back out
    // is asserted by the scope-out test below, which owns that
    // behaviour — repeating it here only bought a hydration race.
    await expect(page.getByTestId("context-pill")).toBeVisible();
  });

  test("a deep link works once scoped in", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/hq");

    const control = page.getByTestId("scope-into-company").first();
    const companyId = await control.getAttribute("data-company-id");
    await control.click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    // The case that matters: scope in, then paste a URL.
    await page.goto(`/admin/companies/${companyId}`);
    await expect(page).toHaveURL(new RegExp(`${companyId}$`));
    expect(await scopeCookie(page)).toBe(companyId);
  });

  test("scoping out clears the cookie", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/hq");
    await page.getByTestId("scope-into-company").first().click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    expect(await scopeCookie(page)).not.toBeNull();

    await openUserMenu(page);
    await page.getByTestId("exit-company-scope").click();

    await expect(page).toHaveURL(/\/admin\/companies$/, { timeout: 30_000 });
    expect(await scopeCookie(page)).toBeNull();
  });
});

test.describe("company URLs without a scope", () => {
  test("an unscoped operator is sent to the picker", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/hq");
    const companyId = await page
      .getByTestId("scope-into-company")
      .first()
      .getAttribute("data-company-id");

    await page.goto(`/admin/companies/${companyId}`);
    await expect(page).toHaveURL(/\/hq$/);
  });
});
