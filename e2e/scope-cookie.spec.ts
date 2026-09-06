import { test, expect, signIn, scopeCookie, users } from "./fixtures";

// THE REGRESSION TEST. This one has an incident behind it.
//
// Scope-in used to be a side effect of GET /admin/companies/<id>,
// written by middleware. A <Link> prefetches when it scrolls into view
// or is hovered, each prefetch is a real request through middleware,
// and the Set-Cookie moved the operator to whichever company was
// prefetched last. Landing on Guide HQ with several company links in
// the viewport and then clicking Dashboard was enough to end up
// looking at the wrong tenant's data.
//
// It survived two attempted fixes and weeks of unit tests, because
// unit tests cannot see it. The thing that goes wrong happens in the
// browser, on its own, without anybody clicking. That is exactly what
// this file is for.
//
// Scope-in is now a server action behind a button and no GET writes
// the cookie. These tests hold that line.

test.describe("the scope cookie is never a navigation side effect", () => {
  test("hovering every company control on Guide HQ leaves it alone", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/hq");

    const before = await scopeCookie(page);

    // Hover each control and let the router do whatever it would do.
    // Under the old model this is the exact gesture that moved you.
    const controls = page.getByTestId("scope-into-company");
    const count = await controls.count();
    expect(count, "Guide HQ should show at least one company").toBeGreaterThan(
      0
    );

    for (let i = 0; i < count; i += 1) {
      await controls.nth(i).hover();
      await page.waitForTimeout(150);
    }
    // Give any speculative fetch time to land and set a cookie.
    await page.waitForTimeout(1000);

    expect(await scopeCookie(page)).toBe(before);
  });

  // The structural guard, and the one with teeth on its own.
  //
  // The hover and scroll tests above only fail if BOTH halves regress:
  // a control goes back to being a <Link> AND middleware goes back to
  // writing on GET. Verified by temporarily restoring the GET write —
  // they stayed green, because a button has nothing to prefetch. This
  // test fails the moment either half returns, because it asserts the
  // shape rather than the symptom.
  test("no anchor anywhere links to a company URL", async ({ page }) => {
    await signIn(page, users.admin());

    for (const path of ["/hq", "/admin/dashboard", "/admin/companies"]) {
      await page.goto(path);
      await expect(page.getByTestId("user-menu-trigger")).toBeVisible();

      const anchors = await page
        .locator('a[href*="/admin/companies/"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("href")));

      // /admin/companies itself is a fine link. A specific company is
      // not: entering one is an action, not a navigation.
      const toACompany = anchors.filter((href) =>
        /\/admin\/companies\/[0-9a-f-]{36}/i.test(href ?? "")
      );

      expect(
        toACompany,
        `${path} links to a company URL. Scope-in must be a button ` +
          "(ScopeIntoCompanyButton), never a <Link> — see scope-request.ts."
      ).toEqual([]);
    }
  });

  test("a direct GET of a company URL writes nothing", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/hq");
    const companyId = await page
      .getByTestId("scope-into-company")
      .first()
      .getAttribute("data-company-id");

    const before = await scopeCookie(page);
    await page.goto(`/admin/companies/${companyId}`);

    // Unscoped, so this bounces to the picker — and crucially does not
    // scope you in on the way.
    await expect(page).toHaveURL(/\/hq$/);
    expect(await scopeCookie(page)).toBe(before);
  });

  test("scrolling Guide HQ end to end leaves it alone", async ({ page }) => {
    // The original report was "I landed on /hq and then I was in the
    // wrong company". Nobody hovered anything deliberately; links
    // prefetched as they scrolled into view.
    await signIn(page, users.admin());
    await page.goto("/hq");
    const before = await scopeCookie(page);

    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(1000);

    expect(await scopeCookie(page)).toBe(before);
  });
});
