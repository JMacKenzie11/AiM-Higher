import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// Drag-to-reorder, on the two lists that have it.
//
// WHY THESE EXIST. Both gestures shipped with a constraint stated out
// loud — "as long as I can still move them around to reorder them" —
// and neither had anything asserting it. The issues list was
// restyled into per-issue blocks (#170) and the companies list gained
// a handle and a persisted order (#172); in both cases the element
// carrying the dnd-kit sortable node is the one whose CSS changed.
// Reasoning said it was fine. This checks.
//
// THE GESTURE IS THE KEYBOARD ONE, AND THAT IS A DELIBERATE CHOICE.
// Both boards register a KeyboardSensor with
// sortableKeyboardCoordinates alongside the PointerSensor. Simulated
// mouse movement against dnd-kit is notoriously timing-dependent —
// the PointerSensor has a 4px activation constraint and the drop
// depends on collision detection resolving mid-move — whereas the
// keyboard path is discrete and deterministic: pick up, move one
// position, drop. It exercises the same reorder handler, the same
// optimistic update and the same server action. A flaky test of the
// mouse path would be worth less than a reliable test of the
// mechanism.
//
// Both specs RESTORE WHAT THEY MOVED. The companies order is a real
// row on a shared clone, so the second half of each test is the
// reverse gesture, and the issues test deletes what it created.

async function keyboardDrag(page: Page, handleLabel: string | RegExp) {
  const handle = page.getByRole("button", { name: handleLabel }).first();
  await expect(handle).toBeVisible({ timeout: 30_000 });
  await handle.focus();
  // dnd-kit's KeyboardSensor: Space picks up, arrows move one
  // position, Space drops.
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
}

async function keyboardDragUp(page: Page, handleLabel: string | RegExp) {
  const handle = page.getByRole("button", { name: handleLabel }).first();
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
}

// Issue ids, in the order they are rendered. Read from the DOM id
// each issue article carries (`issue-<uuid>`) rather than from its
// title text: titles are editable free text and two issues may share
// one, while the id is what the reorder action actually sends.
async function issueOrder(page: Page): Promise<string[]> {
  return page.locator("article[id^='issue-']").evaluateAll((els) =>
    els.map((el) => el.id)
  );
}

// Company names, in rendered order. The rows carry no id, so the
// name control is what identifies a row here.
//
// SELECTED BY TESTID, NOT BY "the first button in the row". The first
// cell is the drag handle once reordering is available, so a
// positional selector reads back the handle's glyph for every row and
// the comparison silently passes against itself. Found by reading the
// markup rather than by the test failing, which it would not have.
async function companyOrder(page: Page): Promise<string[]> {
  return page.locator("tbody tr").evaluateAll((rows) =>
    rows.map(
      (row) =>
        row
          .querySelector('[data-testid="scope-into-company"]')
          ?.textContent?.trim() ?? ""
    )
  );
}

test.describe("drag to reorder", () => {
  test("an issue can be moved down and the new order sticks", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/companies");
    await page.getByTestId("scope-into-company").first().click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await page.goto("/issues");

    // Two issues of our own, so the test never depends on the clone
    // carrying any, and so there is always something below the first
    // one to move past.
    const stamp = Date.now();
    const titles = [`E2E reorder A ${stamp}`, `E2E reorder B ${stamp}`];
    for (const title of titles) {
      await page.getByLabel(/issue/i).first().fill(title);
      await page.getByRole("button", { name: /add issue/i }).click();
      await expect(
        page.getByRole("article").filter({ hasText: title })
      ).toBeVisible({ timeout: 30_000 });
    }

    const before = await issueOrder(page);
    expect(before.length).toBeGreaterThan(1);
    const moved = before[0];

    await keyboardDrag(page, /reorder this issue/i);

    // Optimistic order first: the row moves before the server answers.
    await expect
      .poll(async () => (await issueOrder(page)).indexOf(moved), {
        timeout: 15_000,
      })
      .toBe(1);

    // THE CLAIM THAT MATTERS. A local array swap is not a reorder;
    // the page has to come back the same way after a reload.
    await page.reload();
    await expect
      .poll(async () => (await issueOrder(page)).indexOf(moved), {
        timeout: 30_000,
      })
      .toBe(1);

    // The block travels as one piece. #170 made .issueListItem both
    // the drag node and the wrapper around the issue AND its
    // commitments, so an issue can no longer be separated from them
    // by a reorder.
    const article = page.locator(`article[id='${moved}']`);
    await expect(article).toBeVisible();

    // Clean up what this test created.
    for (const title of titles) {
      const row = page.getByRole("article").filter({ hasText: title });
      page.once("dialog", (d) => d.accept());
      await row.getByRole("button", { name: /delete this issue/i }).click();
      await expect(row).toHaveCount(0, { timeout: 30_000 });
    }
  });

  test("companies can be reordered, and the order is the instance's", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/companies");

    const before = await companyOrder(page);
    test.skip(
      before.length < 2,
      "Reordering needs more than one company, and the handle is not rendered for one."
    );
    const moved = before[0];

    await keyboardDrag(page, new RegExp(`reorder ${escapeRe(moved)}`, "i"));

    await expect
      .poll(async () => (await companyOrder(page)).indexOf(moved), {
        timeout: 15_000,
      })
      .toBe(1);

    // Persisted, not just reordered in this tab. sort_order is a
    // column on the company row (0203), so a reload is the test.
    await page.reload();
    await expect
      .poll(async () => (await companyOrder(page)).indexOf(moved), {
        timeout: 30_000,
      })
      .toBe(1);

    // PUT IT BACK. This is a shared clone and these are real company
    // rows; a test that leaves the portfolio in a different order has
    // changed something it did not own.
    await keyboardDragUp(page, new RegExp(`reorder ${escapeRe(moved)}`, "i"));
    await page.reload();
    await expect
      .poll(async () => await companyOrder(page), { timeout: 30_000 })
      .toEqual(before);
  });
});

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
