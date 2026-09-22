import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";
import type { Page } from "@playwright/test";

// The Agent Hub's two write paths, each walked in a browser and each
// put back the way it was found.
//
// These run against the dev clone, so every test here restores what
// it changed. A rename that leaked would show up on somebody else's
// screen as the product having been renamed, which is exactly the
// blast radius this page has and the reason it is system-admin only.

const SLUG = "ask-better-questions";
// The seeded title, so the restore has something to restore TO even
// when the test failed before it could read the original.
const SEEDED_TITLE = "Ask great questions";

// The slug is on the row element itself, so this addresses the row
// directly. Re-resolved after every write rather than held, because
// router.refresh() replaces the node.
function rowFor(page: import("@playwright/test").Page) {
  return page.locator(`[data-agent-slug="${SLUG}"]`);
}

test.describe("Agent Hub", () => {
  // Restore runs even when the test failed half way. The first
  // version put the rename-back at the end of the test body, and a
  // failure before it left the agent called "E2E Renamed 1790…" on
  // the dev clone, where it showed up in the next run's picker as
  // though the product had been renamed. A cleanup that only runs on
  // the happy path is not a cleanup.
  test.afterEach(async ({ page }) => {
    await page.goto("/admin/agents");
    const row = page.locator(`[data-agent-slug="${SLUG}"]`);
    if ((await row.count()) === 0) return;

    if (!(await row.innerText()).includes(SEEDED_TITLE)) {
      await row.getByRole("button", { name: /^edit$/i }).click();
      await row.getByLabel(/^name$/i).fill(SEEDED_TITLE);
      await row.getByRole("button", { name: /^save$/i }).click();
      await expect(rowFor(page)).toContainText(SEEDED_TITLE, {
        timeout: 15_000,
      });
    }

    const after = rowFor(page);
    const summary = await after
      .getByTestId("agent-hub-access-summary")
      .innerText();
    if (/compan(y|ies)/i.test(summary)) {
      await after.getByRole("button", { name: /^access$/i }).click();
      for (const box of await after.locator('input[type="checkbox"]').all()) {
        if (await box.isChecked()) await box.uncheck();
      }
      await after.getByRole("button", { name: /^save$/i }).click();
      await expect(
        rowFor(page).getByTestId("agent-hub-access-summary")
      ).not.toContainText(/compan(y|ies)/i, { timeout: 15_000 });
    }
  });

  test("renames an agent, sees it in the picker, and renames it back", async ({
    page,
  }) => {
    const marker = `E2E Renamed ${Date.now()}`;

    await signIn(page, users.admin());
    await page.goto("/admin/agents");

    const row = rowFor(page);
    await expect(row).toBeVisible();
    await expect(row).toContainText(SEEDED_TITLE);

    await row.getByRole("button", { name: /^edit$/i }).click();
    const nameField = row.getByLabel(/^name$/i);
    await nameField.fill(marker);
    await row.getByRole("button", { name: /^save$/i }).click();

    await expect(rowFor(page)).toContainText(marker, { timeout: 15_000 });

    // The edit has to reach the surface people actually use, not
    // just the screen that made it. This is the whole point of the
    // merge layer, and the failure it is guarding against is a
    // rename that shows only in the Hub.
    //
    // The picker is a modal inside a chat, not a list on /ask-aimee
    // (the Practice Coaches tab was retired), so this opens a plain
    // conversation and clicks the composer's agent control. The
    // conversation is left behind deliberately: it carries no user
    // turns, so it is never summarized and costs nothing.
    //
    // Coaching runs against a company's context, and a system admin
    // belongs to none, so the chat refuses to start until we scope
    // in. Same idiom as the chart specs.
    await page.goto("/admin/companies");
    await page
      .getByTestId("scope-into-company")
      .filter({ hasText: new RegExp(`^${FIXTURE_COMPANY_NAME}$`) })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    // Started from the button on /ask-aimee rather than by visiting
    // /ask-aimee/new directly. That route currently 500s on a plain
    // start: it calls createGeneralConversationAction during render,
    // and that action calls revalidatePath, which Next forbids
    // mid-render. Pre-existing on main and not this PR's to fix; the
    // button is the path a person actually takes.
    await page.goto("/ask-aimee");
    await page.getByRole("button", { name: /new conversation/i }).click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    await page
      .getByRole("button", { name: /change agent/i })
      .click({ timeout: 30_000 });
    const picker = page.getByRole("dialog");
    await expect(picker).toBeVisible();
    await expect(picker.getByText(marker)).toBeVisible({ timeout: 15_000 });
    await picker.getByRole("button", { name: /^close$/i }).click();

    // Putting it back is afterEach's job, so that it happens even
    // when an assertion above throws.
  });

  test("limits an agent to one company and opens it up again", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/agents");

    const row = rowFor(page);
    await expect(row).toBeVisible();
    const summary = row.getByTestId("agent-hub-access-summary");
    // Starts with no allowlist, which reads as every company.
    await expect(summary).not.toContainText(/compan(y|ies)/i);

    await row.getByRole("button", { name: /^access$/i }).click();
    const firstCompany = row.locator('input[type="checkbox"]').last();
    await firstCompany.check();
    await row.getByRole("button", { name: /^save$/i }).click();

    await expect(rowFor(page).getByTestId("agent-hub-access-summary")).toContainText(
      /1 company/i,
      { timeout: 15_000 }
    );

    // Clearing the allowlist is afterEach's job, same reason.
  });

  test("refuses to hide a category that still holds agents", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/agents");

    const categories = page.getByTestId("agent-hub-categories");
    const populated = categories
      .getByTestId("agent-hub-category-row")
      .filter({ hasText: /[1-9]\d* agents?/ })
      .first();
    await populated.getByRole("button", { name: /^hide$/i }).click();

    // A refusal, in a sentence, with the thing to do next in it.
    // Not a thrown error and not a silent no-op.
    await expect(page.getByTestId("agent-hub-message")).toContainText(
      /move its agents/i,
      { timeout: 15_000 }
    );
    // And the category is still there, still showing its agents.
    await expect(populated).toBeVisible();
  });

  test("is closed to a team member", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/admin/agents");
    // requireRole redirects rather than rendering; what matters is
    // that the editor never appears.
    await expect(page.getByTestId("agent-hub-agents")).toHaveCount(0);
  });
});

// Who the merged agent list admits, walked as three real accounts.
//
// The sharp pair is the last two: same role (team_member), same
// company, and the ONLY difference between them is the lead_id on
// "E2E Led Function". So an agent one sees and the other does not is
// the function-lead predicate and nothing else. Both fixtures come
// from `npm run seed:e2e`.
//
// Read-only. Nothing here writes, so there is nothing to restore.
async function pickerText(page: Page): Promise<string> {
  await page.goto("/ask-aimee");
  await page.getByRole("button", { name: /new conversation/i }).click();
  await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
    timeout: 30_000,
  });
  await page
    .getByRole("button", { name: /change agent/i })
    .click({ timeout: 30_000 });
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible();
  return picker.innerText();
}

test.describe("who the agent picker admits", () => {
  test("a company_admin sees the People agents", async ({ page }) => {
    await signIn(page, users.companyAdmin());
    const text = await pickerText(page);
    expect(text).toContain("Functional Chart Builder");
    expect(text).toContain("Role Description Creator");
  });

  test("a plain team_member sees neither", async ({ page }) => {
    await signIn(page, users.member());
    const text = await pickerText(page);
    expect(text).not.toContain("Functional Chart Builder");
    expect(text).not.toContain("Role Description Creator");
  });

  test("a team_member who leads a function sees only the one that admits leads", async ({
    page,
  }) => {
    await signIn(page, users.lead());
    const text = await pickerText(page);
    // Admits function leads on top of its allowedRoles.
    expect(text).toContain("Role Description Creator");
    // Does not. This half is what stops the predicate being read as
    // "leading a function widens everything".
    expect(text).not.toContain("Functional Chart Builder");
  });
});
