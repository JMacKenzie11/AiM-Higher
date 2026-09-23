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

// Open a fresh chat, and survive whatever navigation is still
// settling from the step before.
//
// This used to be three inline lines, and it flaked: clicking
// straight after goto() raced an RSC navigation left over from the
// rename's router.refresh(), and Playwright timed out waiting for
// that navigation to finish while the button sat plainly visible on
// screen. It passed in isolation and failed in sequence, which is
// the worst shape for a test to have — the repo's own fixtures.ts
// notes that a suite going red for no reason gets ignored, then
// deleted.
//
// Asserting the button visible first gives the in-flight navigation
// somewhere to land before the click is attempted.
async function startConversation(page: Page): Promise<void> {
  // goto, retried once on ERR_ABORTED.
  //
  // An abort here does not mean the page is broken: it means another
  // navigation superseded this one, which is what a scope-in or a
  // router.refresh() landing a moment late looks like. Seen once in
  // this spec. The retry costs one navigation on a rare race and
  // removes a failure mode that reads like a product bug in the
  // report.
  try {
    await page.goto("/ask-aimee");
  } catch (err) {
    if (!String(err).includes("ERR_ABORTED")) throw err;
    await page.goto("/ask-aimee");
  }
  const start = page.getByRole("button", { name: /new conversation/i });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
    timeout: 30_000,
  });
}

// Edit and Access open the house drawer, which portals to
// document.body — so the form is NOT inside the row, and a
// row-scoped locator finds nothing. Addressed by drawer name, the
// same way the chart specs tell that page's two drawers apart.
function drawer(page: Page, which: "agent-edit" | "agent-access") {
  return page
    .getByTestId("drawer-panel")
    .and(page.locator(`[data-drawer-name="${which}"]`));
}

async function openDrawer(
  page: Page,
  which: "agent-edit" | "agent-access"
): Promise<void> {
  const button = which === "agent-edit" ? /^edit$/i : /^access$/i;
  await rowFor(page).getByRole("button", { name: button }).click();
  await expect(drawer(page, which)).toBeVisible({ timeout: 15_000 });
}

test.describe("Agent Hub", () => {
  // Restore runs even when the test failed half way. The first
  // version put the rename-back at the end of the test body, and a
  // failure before it left the agent called "E2E Renamed 1790…" on
  // the dev clone, where it showed up in the next run's picker as
  // though the product had been renamed. A cleanup that only runs on
  // the happy path is not a cleanup.
  // BEFORE as well as after.
  //
  // afterEach puts the fixture back, but only if the run reaches it.
  // A run killed part way — a crashed browser, a cancelled CI job,
  // somebody pressing ctrl-c — leaves the agent renamed, and the
  // NEXT run then fails on its first assertion with a title from
  // last week. The suite was depending on its own cleanup having
  // succeeded on a previous occasion, which is not something a test
  // gets to assume.
  test.beforeEach(async ({ page }) => {
    await restoreFixture(page);
  });

  test.afterEach(async ({ page }) => {
    await restoreFixture(page);
  });

  async function restoreFixture(page: Page) {
    await signIn(page, users.admin());
    await page.goto("/admin/agents");
    const row = page.locator(`[data-agent-slug="${SLUG}"]`);
    if ((await row.count()) === 0) return;

    if (!(await row.innerText()).includes(SEEDED_TITLE)) {
      await openDrawer(page, "agent-edit");
      const d = drawer(page, "agent-edit");
      await d.getByLabel(/^name$/i).fill(SEEDED_TITLE);
      await d.getByRole("button", { name: /^save$/i }).click();
      await expect(rowFor(page)).toContainText(SEEDED_TITLE, {
        timeout: 15_000,
      });
    }

    const summary = await rowFor(page)
      .getByTestId("agent-hub-access-summary")
      .innerText();
    if (/functional leads/i.test(summary)) {
      await openDrawer(page, "agent-access");
      const d = drawer(page, "agent-access");
      for (const box of await d.locator('input[type="checkbox"]').all()) {
        if (await box.isChecked()) await box.uncheck();
      }
      await d.getByRole("button", { name: /^save$/i }).click();
      await expect(
        rowFor(page).getByTestId("agent-hub-access-summary")
      ).not.toContainText(/functional leads/i, { timeout: 15_000 });
    }
  }

  test("renames an agent, sees it in the picker, and renames it back", async ({
    page,
  }) => {
    const marker = `E2E Renamed ${Date.now()}`;

    await signIn(page, users.admin());
    await page.goto("/admin/agents");

    const row = rowFor(page);
    await expect(row).toBeVisible();
    await expect(row).toContainText(SEEDED_TITLE);

    await openDrawer(page, "agent-edit");
    const d = drawer(page, "agent-edit");
    await d.getByLabel(/^name$/i).fill(marker);
    await d.getByRole("button", { name: /^save$/i }).click();

    // The drawer closes itself on a successful save.
    await expect(d).toHaveCount(0, { timeout: 15_000 });
    await expect(rowFor(page)).toContainText(marker, { timeout: 15_000 });
    // And then WAIT FOR THE WRITE TO SETTLE before navigating away.
    //
    // Every write on this page runs inside a transition that ends in
    // router.refresh(). Navigating while that is still in flight let
    // the late refresh pull the browser back to /admin/agents,
    // halfway through opening a chat — which surfaced as the picker
    // step failing on a URL that made no sense for it.
    //
    // The row's buttons are disabled for exactly the life of that
    // transition, so re-enabled is the precise signal, and a better
    // one than a sleep or networkidle.
    await expect(
      rowFor(page).getByRole("button", { name: /^edit$/i })
    ).toBeEnabled({ timeout: 15_000 });

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
    // toHaveURL passes as soon as the URL matches, which can be
    // before the navigation has finished. Letting it finish is what
    // stops the next goto aborting it.
    await page.waitForLoadState("load");

    // Started from the button on /ask-aimee rather than by visiting
    // /ask-aimee/new directly. That route currently 500s on a plain
    // start: it calls createGeneralConversationAction during render,
    // and that action calls revalidatePath, which Next forbids
    // mid-render. Pre-existing on main and not this PR's to fix; the
    // button is the path a person actually takes.
    await startConversation(page);
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

  test("admits Functional Leads, and takes it back", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/agents");

    const row = rowFor(page);
    await expect(row).toBeVisible();
    // Seeds with no predicates, so the summary names roles only.
    await expect(row.getByTestId("agent-hub-access-summary")).not.toContainText(
      /functional leads/i
    );

    await openDrawer(page, "agent-access");
    const d = drawer(page, "agent-access");
    // Its own labelled control now, rather than the last checkbox in
    // the roles list, so this no longer depends on ordering.
    await d.getByRole("checkbox", { name: /functional leads/i }).check();
    await d.getByRole("button", { name: /^save$/i }).click();
    await expect(d).toHaveCount(0, { timeout: 15_000 });

    await expect(
      rowFor(page).getByTestId("agent-hub-access-summary")
    ).toContainText(/functional leads/i, { timeout: 15_000 });

    // Taking it back is afterEach's job, so that it happens even when
    // an assertion above throws.
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
  await startConversation(page);
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
