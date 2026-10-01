import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";
import { ADMIN_ONLY_CONTROLS } from "../src/lib/help/admin-only-controls";

// PAGES EVERY ROLE CAN OPEN, BUT ONLY ADMINS CAN CHANGE (2026-09-29).
//
// A team member must see the page and none of its admin controls. A
// company admin must see those controls, which is what proves the
// labels in the list are the page's real ones: the same list the help
// test checks the team member's help against
// (src/lib/help/help-for-team-members.test.ts). Reads only; nothing is
// clicked, so nothing is written.

test.use({ viewport: { width: 1440, height: 900 } });

// A button, a link, or a disclosure (<summary>, which has neither
// role): the One-Page Plan's adds are disclosures.
function control(page: Page, name: string) {
  return page
    .getByRole("button", { name, exact: true })
    .or(page.getByRole("link", { name, exact: true }))
    .or(page.locator("summary").getByText(name, { exact: true }))
    // Visible ones only: Aimee's panel stays in the page, hidden, with
    // its own "Close" button.
    .filter({ visible: true });
}

async function openPage(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
}

test("a team member sees each page, and none of its admin controls", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, users.member());
  for (const { path, controls } of ADMIN_ONLY_CONTROLS) {
    await openPage(page, path);
    for (const name of controls) {
      await expect(control(page, name), `${path}: a team member sees "${name}"`).toHaveCount(0);
    }
  }
});

test("a company admin sees those controls, so the list names real ones", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, users.companyAdmin());
  for (const { path, controls } of ADMIN_ONLY_CONTROLS) {
    await openPage(page, path);
    for (const name of controls) {
      await expect(control(page, name).first(), `${path}: a company admin does not see "${name}"`).toBeVisible({
        timeout: 30_000,
      });
    }
  }
});
