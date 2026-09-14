import {
  test,
  expect,
  openUserMenu,
  signIn,
  scopeCookie,
  scopedCompanyId,
  users,
} from "./fixtures";

// The portfolio owner's whole journey, as a real portfolio_admin.
//
// SIGNED IN AS THE ACTUAL ROLE, never as a system_admin standing in
// for one. Everything worth proving here is about what this role
// cannot do, and a stand-in can do all of it.

test.describe("portfolio_admin", () => {
  test("lands on /portfolio and sees a card per company", async ({ page }) => {
    await signIn(page, users.portfolio());

    // Root routing sends them here; no scope cookie is involved.
    await page.goto("/");
    await expect(page).toHaveURL(/\/portfolio$/, { timeout: 30_000 });
    expect(await scopeCookie(page)).toBeNull();

    // At least the seeded fixture company, with its numbers.
    const cards = page.getByRole("listitem").filter({
      has: page.getByTestId("scope-into-company"),
    });
    await expect(cards.first()).toBeVisible();

    // The denominator travels with the scorecard. Without it a reader
    // compares two overalls that are means over different sets.
    await expect(
      cards.first().getByText(/across \d+ disciplines?/i)
    ).toBeVisible();
  });

  test("the nav offers the portfolio and no platform surfaces", async ({
    page,
  }) => {
    await signIn(page, users.portfolio());
    await page.goto("/portfolio");

    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: /overview/i })).toBeVisible();
    // Guide HQ and the platform tools belong to other roles.
    await expect(nav.getByRole("link", { name: /^platform$/i })).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: /classroom admin/i })
    ).toHaveCount(0);
  });

  test("scopes into a company and finds it read-only", async ({ page }) => {
    await signIn(page, users.portfolio());
    await page.goto("/portfolio");

    const control = page.getByTestId("scope-into-company").first();
    const companyId = await control.getAttribute("data-company-id");
    await control.click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    // scopedCompanyId, not scopeCookie: the cookie is
    // `<profileId>:<companyId>` since the binding landed, so comparing
    // the raw value to a company id would fail for a reason that has
    // nothing to do with this page.
    expect(await scopedCompanyId(page)).toBe(companyId);
    await expect(page.getByTestId("context-pill")).toBeVisible();

    // READ-ONLY IS THE CLAIM. Every content surface computes its edit
    // affordance from isAdminForCompany, which does not admit this
    // role, so the write controls are absent rather than disabled.
    // Checked on three surfaces rather than one: they are gated
    // independently and could diverge.
    for (const path of ["/plan", "/commitments", "/foundation"]) {
      await page.goto(path);
      await expect(
        page.getByRole("button", { name: /^(add|new|create) /i })
      ).toHaveCount(0);
    }

    // And the read itself works, which is what makes the absences
    // above mean something rather than describing an empty page.
    await page.goto("/dashboard");
    await expect(page.getByTestId("context-pill")).toBeVisible();
  });

  test("scopes out, back to the portfolio", async ({ page }) => {
    await signIn(page, users.portfolio());
    await page.goto("/portfolio");
    await page.getByTestId("scope-into-company").first().click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    await openUserMenu(page);
    await page.getByRole("button", { name: /exit company/i }).click();

    await expect(page).toHaveURL(/\/(portfolio|admin\/companies)$/, {
      timeout: 30_000,
    });
    expect(await scopeCookie(page)).toBeNull();
  });

  test("creates a company from the portfolio", async ({ page }) => {
    await signIn(page, users.portfolio());
    await page.goto("/portfolio");

    // A name nobody else uses, and a new one per run: the spec runs
    // against the dev clone, which is not reset between runs, and a
    // fixed name would pass once and then collide with itself.
    const name = `E2E Portfolio Co ${Date.now()}`;
    await page.getByLabel(/^company name$/i).fill(name);
    await page.getByRole("button", { name: /create company/i }).click();

    // The new company appears as an ordinary card. Creating it also
    // seeds its chart roots and opening quarter through
    // seed_company_roots, which this role holds no content grant for.
    await expect(page.getByText(name, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("cannot reach Guide HQ or the platform dashboard", async ({ page }) => {
    // The nav does not offer them; requireRole is what actually
    // refuses them, and a URL typed by hand is the way that gets
    // tested.
    await signIn(page, users.portfolio());

    for (const path of ["/hq", "/admin/dashboard"]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(new RegExp(`${path}$`), {
        timeout: 30_000,
      });
    }
  });
});
