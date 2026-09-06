import { test as base, expect, type Page } from "@playwright/test";

// Shared helpers. Everything here uses roles, labels or data-testid.
// Never copy text: the wording of this product changes weekly and a
// test that breaks on a reworded button teaches people to ignore the
// suite.

export const SCOPE_COOKIE = "aims_scope_company";

// The company `npm run seed:e2e` creates. Looked up by name rather
// than hardcoded by id, because a dev-clone refresh changes every id.
export const FIXTURE_COMPANY_NAME = "E2E Fixture Co";

function credential(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. These live in .env.local; run \`npm run seed:e2e\` ` +
        "after a dev-clone refresh. See docs/e2e.md."
    );
  }
  return value;
}

export const users = {
  // system_admin, plus a guide assignment to the fixture company.
  admin: () => ({
    email: credential("E2E_ADMIN_EMAIL"),
    password: credential("E2E_ADMIN_PASSWORD"),
  }),
  // team_member inside the fixture company: the least-privileged real
  // user, which is the right one to test ordinary navigation with.
  member: () => ({
    email: credential("E2E_MEMBER_EMAIL"),
    password: credential("E2E_MEMBER_PASSWORD"),
  }),
};

export async function signIn(
  page: Page,
  who: { email: string; password: string }
): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel(/^email$/i).fill(who.email);
  await page.getByLabel(/^password$/i).fill(who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Landing differs by role, so wait for the app rather than a URL:
  // the sidebar only renders once a session resolved.
  await expect(page.getByTestId("user-menu-trigger")).toBeVisible({
    timeout: 30_000,
  });
}

// Opens the user menu, retrying the click.
//
// Not defensive padding: the menu is a client component and the click
// can land before React attaches its handler, in which case nothing
// happens and the test waits 30s for an element that will never
// appear. Measured — this was a real flake on the second full run.
// Playwright's actionability checks cover "is it clickable", not "is
// it hydrated", so the retry is the honest fix.
export async function openUserMenu(page: Page): Promise<void> {
  const trigger = page.getByTestId("user-menu-trigger");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

export async function scopeCookie(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  const hit = cookies.find((c) => c.name === SCOPE_COOKIE);
  return hit && hit.value.length > 0 ? hit.value : null;
}

// The fixture company's id, read from a scope-in control rather than
// from the database, so the specs need no service key of their own.
export async function fixtureCompanyId(page: Page): Promise<string> {
  const button = page.getByTestId("scope-into-company").first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  const id = await button.getAttribute("data-company-id");
  if (!id) throw new Error("scope-into-company button carried no company id");
  return id;
}

export { expect };
export const test = base;
