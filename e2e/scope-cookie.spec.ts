import { test, expect, signIn, scopeCookie, users } from "./fixtures";
import type { Page } from "@playwright/test";

// Counts this app's requests from the moment it is created, and waits
// until none has been in flight for half a second. The tests below
// prove that a hover or a scroll sets NO cookie, so they have to wait
// until every prefetch those gestures started has come back, not for
// a fixed length of time. Other hosts (analytics) are left out: they
// never reach middleware and would keep the page from ever going quiet.
function trackRequests(page: Page) {
  const origin = new URL(page.url() === "about:blank" ? "http://localhost" : page.url()).origin;
  let inFlight = 0;
  let lastChange = Date.now();
  const mine = (url: string) => new URL(url).origin === origin;
  page.on("request", (r) => {
    if (mine(r.url())) { inFlight += 1; lastChange = Date.now(); }
  });
  const done = (r: { url(): string }) => {
    if (mine(r.url())) { inFlight = Math.max(0, inFlight - 1); lastChange = Date.now(); }
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return {
    quiet: () =>
      expect
        .poll(() => inFlight === 0 && Date.now() - lastChange >= 500, {
          timeout: 15_000,
          intervals: [100],
        })
        .toBe(true),
  };
}

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

    const requests = trackRequests(page);
    for (let i = 0; i < count; i += 1) {
      await controls.nth(i).hover();
    }
    // Every speculative fetch the hovers started has come back.
    await requests.quiet();

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

    const requests = trackRequests(page);
    await page.mouse.wheel(0, 4000);
    await requests.quiet();
    await page.mouse.wheel(0, -4000);
    // Every prefetch the scrolling started has come back.
    await requests.quiet();

    expect(await scopeCookie(page)).toBe(before);
  });
});
