import { test, expect, signIn, users } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

// The issue commitment thread, end to end, in the work drawer.
//
// An issue is worked through a SEQUENCE of commitments. Since
// 2026-10-16 an issue is one line on /issues and everything else is in
// the drawer its description opens (components/work-drawer): the
// description, what we want, notes, and its commitments with the line
// to add the next one. This walks the loop the design is for: add
// one, land it, add another, land that, resolve.
//
// Signed in as the admin fixture, a system_admin scoped into the
// fixture company: it can create issues, own commitments and resolve,
// which is the whole path.
//
// Controls are found by their labels, not their placeholders: copy
// changes when a reader is confused, a label when the control does.

const ISSUE_TITLE = () => `E2E thread issue ${Date.now()}`;

async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^E2E Fixture Co$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await page.goto("/issues");
}

// "Add an issue" opens the drawer on a new issue with the description
// focused; "Add issue" saves it and leaves the drawer open on it.
async function createIssue(page: Page, title: string): Promise<Locator> {
  await page.getByRole("button", { name: "Add an issue" }).click();
  const drawer = page.getByTestId("drawer-panel");
  await expect(drawer.getByLabel("Description")).toBeFocused();
  await page.keyboard.type(title);
  await drawer.getByRole("button", { name: "Add issue" }).click();
  await expect(drawer.getByRole("heading", { name: "Commitments" })).toBeVisible({
    timeout: 30_000,
  });
  return drawer;
}

async function addCommitment(drawer: Locator, description: string) {
  await drawer.getByLabel("New commitment").fill(description);
  await drawer.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    drawer.getByTestId("commitment-row").filter({ hasText: description }),
  ).toBeVisible({ timeout: 30_000 });
}

// The circle OPENS A MENU and never resolves on click, as everywhere.
// Found by what the commitment says, not by position.
async function landCommitment(drawer: Locator, description: string) {
  const line = drawer
    .getByTestId("commitment-row")
    .filter({ hasText: description });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await line.getByRole("button", { name: /open actions/i }).click();
  await line
    .getByRole("menuitem", { name: /^mark kept( \((on time|late)\))?$/i })
    .first()
    .click();
  await expect(line.getByText(/marked kept/i)).toBeVisible({ timeout: 30_000 });
}

test.describe("issue commitment thread", () => {
  test.describe.configure({ timeout: 120_000 });

  test("add, land, add next, land, resolve", async ({ page }) => {
    await scopeIn(page);
    const title = ISSUE_TITLE();
    const drawer = await createIssue(page, title);

    await addCommitment(drawer, "First attempt");
    await landCommitment(drawer, "First attempt");
    // The add line is always there, at the end of the thread.
    await addCommitment(drawer, "Second attempt");
    await landCommitment(drawer, "Second attempt");

    await drawer.getByRole("button", { name: "Close" }).click();
    const row = page.getByRole("article").filter({ hasText: title });
    // Nothing open on it, so no badge.
    await expect(row.getByLabel(/open commitment/)).toHaveCount(0);

    // The circle never resolves on the click: the confirm dialog is
    // the second gesture.
    await row.getByRole("button", { name: /resolve this issue/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Resolve", exact: true }).click();

    await expect(
      page
        .getByRole("region", { name: "Open issues" })
        .getByRole("article")
        .filter({ hasText: title }),
    ).toHaveCount(0, { timeout: 30_000 });
    await expect(
      page
        .getByRole("region", { name: "Resolved issues" })
        .getByRole("article")
        .filter({ hasText: title }),
    ).toHaveCount(1);
  });

  test("a second commitment can be added while the first is still open", async ({
    page,
  }) => {
    await scopeIn(page);
    const title = ISSUE_TITLE();
    const drawer = await createIssue(page, title);

    await addCommitment(drawer, "First, still open");
    await addCommitment(drawer, "Second, alongside");
    await drawer.getByRole("button", { name: "Close" }).click();

    // AND BOTH SURVIVE A RELOAD, counted on the row and listed in the
    // drawer.
    await page.goto("/dashboard");
    await page.goto("/issues");
    const row = page.getByRole("article").filter({ hasText: title });
    await expect(row.getByLabel("2 open commitments")).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: title }).click();
    const reopened = page.getByTestId("drawer-panel");
    await expect(reopened.getByText("First, still open")).toBeVisible({ timeout: 30_000 });
    await expect(reopened.getByText("Second, alongside")).toBeVisible();
  });

  test("notes save, and a commitment opens in place with a way back", async ({ page }) => {
    await scopeIn(page);
    const title = ISSUE_TITLE();
    const drawer = await createIssue(page, title);

    // Issue notes, with bold, saved with Save.
    await drawer.getByRole("textbox", { name: "Issue notes" }).click();
    await page.keyboard.type("Context for the team. ");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.type("Bold part");
    await drawer.getByRole("button", { name: "Save", exact: true }).click();
    await expect(drawer.getByText("Saved")).toBeVisible({ timeout: 30_000 });

    // A commitment opened from the issue swaps the drawer's content.
    await addCommitment(drawer, "Ask for two quotes");
    await drawer
      .getByTestId("commitment-row")
      .filter({ hasText: "Ask for two quotes" })
      .getByRole("button", { name: "Ask for two quotes" })
      .click();
    await expect(drawer.getByRole("button", { name: /back to the issue/i })).toBeVisible();
    await expect(page.getByTestId("drawer-panel")).toHaveCount(1);
    await drawer.getByRole("textbox", { name: "Commitment notes" }).click();
    await page.keyboard.type("Both quotes due Wednesday.");

    // Leaving with unsaved notes asks first; Escape keeps editing.
    await drawer.getByRole("button", { name: /back to the issue/i }).click();
    await expect(page.getByText("Save your changes?")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer.getByRole("textbox", { name: "Commitment notes" })).toContainText(
      "Both quotes due Wednesday.",
    );
    await drawer.getByRole("button", { name: "Save", exact: true }).click();
    await expect(drawer.getByText("Saved")).toBeVisible({ timeout: 30_000 });
    await drawer.getByRole("button", { name: /back to the issue/i }).click();

    // After a reload, both notes are still there, and the commitment
    // carries its notes icon.
    await page.reload();
    const row = page.getByRole("article").filter({ hasText: title });
    await row.getByRole("button", { name: title }).click();
    const again = page.getByTestId("drawer-panel");
    await expect(again.getByRole("textbox", { name: "Issue notes" }).locator("strong")).toHaveText(
      "Bold part",
      { timeout: 30_000 },
    );
    await expect(again.getByRole("img", { name: /Has notes: Both quotes due Wednesday\./ })).toBeVisible();
  });

  test("deleting an issue can be undone", async ({ page }) => {
    await scopeIn(page);
    const title = ISSUE_TITLE();
    const drawer = await createIssue(page, title);
    await drawer.getByRole("button", { name: "Close" }).click();

    const row = page.getByRole("article").filter({ hasText: title });
    await row.getByRole("button", { name: "Delete this issue" }).click();
    // No confirmation box: it goes at once, and Undo brings it back.
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(row).toHaveCount(1);
  });
});
