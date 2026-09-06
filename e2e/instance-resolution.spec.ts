import { test, expect } from "@playwright/test";

// The fail-closed path, against a server with no instance override.
//
// A hostname that resolves to no instance must be rewritten to
// /instance-not-found BEFORE anything touches Supabase — no session
// refresh, no app route reachable, no marketing page. This is the
// property that stops one customer's hostname quietly serving another
// customer's database, and it is invisible from the main suite, where
// LOCAL_INSTANCE_* pins every request to the dev database and the
// hostname is ignored entirely.
//
// Only "localhost" is exercised. It is a single label, which
// resolve.ts rejects before consulting the registry — and the registry
// lives in the PRODUCTION project. A hostname with a domain under it
// would reach for it. See playwright.config.ts.

test.describe("a hostname that resolves to no instance", () => {
  test("serves the not-found page on every route", async ({ page }) => {
    for (const path of [
      "/",
      "/sign-in",
      "/dashboard",
      "/hq",
      "/admin/companies",
      "/accept-invite",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should still be a 200`).toBe(200);

      // The marketing landing and the auth pages have to be
      // unreachable too, not just the app routes.
      await expect(
        page.getByRole("heading", { level: 1 }),
        `${path} reached something other than the not-found page`
      ).toHaveAttribute("data-testid", "instance-not-found");
    }
  });

  test("the not-found page itself renders rather than rewriting forever", async ({
    page,
  }) => {
    await page.goto("/instance-not-found");
    await expect(
      page.getByTestId("instance-not-found")
    ).toBeVisible();
  });

  test("no session cookie is ever set", async ({ page }) => {
    // Nothing on this path may touch Supabase: there is no database to
    // check a session against.
    await page.goto("/dashboard");
    const cookies = await page.context().cookies();
    expect(cookies.filter((c) => c.name.startsWith("sb-"))).toEqual([]);
  });
});
