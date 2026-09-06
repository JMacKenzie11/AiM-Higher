import { test, expect, signIn, users } from "./fixtures";

test.describe("sign in", () => {
  // Root-path routing is a middleware rule: authenticated cross-tenant
  // roles go to /hq, everyone else to /dashboard.
  //
  // Asserted after a reload rather than straight off the sign-in
  // redirect. signInAction redirects to "/", and on that client-side
  // transition Next can render the routed page while the address bar
  // still reads "/". Cosmetic, and not what these tests are about; the
  // reload makes middleware answer as a document request, which is the
  // rule we care about.
  test("a system_admin is routed to Guide HQ", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/");
    await expect(page).toHaveURL(/\/hq$/);
  });

  test("a company user is routed to their dashboard", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("wrong credentials are refused and nothing is granted", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/^email$/i).fill(users.admin().email);
    await page.getByLabel(/^password$/i).fill("definitely-not-the-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
    // The sidebar is the app; it must not have rendered.
    await expect(page.getByTestId("user-menu-trigger")).toHaveCount(0);
  });

  test("an anonymous visitor cannot reach an app route", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
