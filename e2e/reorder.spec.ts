import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";
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

// One step of a keyboard drag: pick up, move, drop.
//
// THE WAITS BETWEEN THE KEYS ARE THE POINT, and they are not padding
// against flake. dnd-kit's KeyboardSensor does its work across
// animation frames: Space registers the pick-up, and the sensor is
// not ready to interpret an arrow until that has settled. Fired
// back-to-back, the arrow and the drop land before the drag exists
// and nothing moves at all — which looks exactly like a drag that ran
// and was refused, and cost an hour of suspecting the gesture, then
// the selectors, then hydration. A diagnostic spec with 300ms between
// the keys moved the row every time.
async function keyboardMove(
  page: Page,
  handleLabel: string | RegExp,
  direction: "ArrowDown" | "ArrowUp",
) {
  const handle = page.getByRole("button", { name: handleLabel }).first();
  await expect(handle).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  // Bring the handle into view before using it. The create-issue
  // field sits at the BOTTOM of the issues list, so typing there
  // leaves the viewport scrolled away from the row being dragged,
  // and dnd-kit's keyboard sensor works from element rects. focus()
  // alone does not scroll.
  await handle.scrollIntoViewIfNeeded();
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press(direction);
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
}

const keyboardDrag = (page: Page, label: string | RegExp) =>
  keyboardMove(page, label, "ArrowDown");

const keyboardDragUp = (page: Page, label: string | RegExp) =>
  keyboardMove(page, label, "ArrowUp");

// Let the reorder actually reach the server before reloading.
//
// THIS IS NOT PADDING. The optimistic update lands synchronously, so
// the "did it move" assertion passes within milliseconds while the
// server action is still in flight. Reloading at that moment aborts
// the write, the page comes back in the old order, and the failure
// reads as "reordering does not persist" — which is what it looked
// like for two rounds of this being debugged. The feature was fine
// every time; the test was racing it.
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1_000);
}

// Issue ids, in the order they are rendered. Read from the DOM id
// each issue article carries (`issue-<uuid>`) rather than from its
// title text: titles are editable free text and two issues may share
// one, while the id is what the reorder action actually sends.
async function issueOrder(page: Page): Promise<string[]> {
  return page
    .locator("article[id^='issue-']")
    .evaluateAll((els) => els.map((el) => el.id));
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
  // Filtered, because `tbody tr` catches every table on this page —
  // the guide caseloads and the unrouted-meeting queue live here too.
  // Without the filter their rows enter the array as empty strings,
  // and an empty string at index 0 makes indexOf() answer 0 forever.
  return page
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows
        .map(
          (row) =>
            row
              .querySelector('[data-testid="scope-into-company"]')
              ?.textContent?.trim() ?? "",
        )
        .filter(Boolean),
    );
}

test.describe("drag to reorder", () => {
  test("an issue can be moved down and the new order sticks", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/companies");
    // The fixture company, never a copy of a client's. `.first()` was
    // whichever company sorted first, which was a client's.
    await page
      .getByTestId("scope-into-company")
      .filter({ hasText: new RegExp(`^${FIXTURE_COMPANY_NAME}$`) })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await page.goto("/issues");

    // Two issues of our own, so the test never depends on the clone
    // carrying any, and so there is always something below the first
    // one to move past.
    const stamp = Date.now();
    const titles = [`E2E reorder A ${stamp}`, `E2E reorder B ${stamp}`];
    for (const title of titles) {
      await page.getByLabel("New issue").fill(title);
      // Enter submits the form. The submit button reads "Add", not
      // "Add issue", and there is one per commitment add-line too.
      await page.getByLabel("New issue").press("Enter");
      await expect(
        page.getByRole("article").filter({ hasText: title }),
      ).toBeVisible({ timeout: 30_000 });
    }

    // Reload onto a quiet board before touching the drag.
    //
    // Creating the two issues leaves the client mid-flight: each
    // create is a server action plus a revalidate, and IssuesBoard
    // resyncs its local order from the incoming props. Dragging in
    // that window does nothing at all — measured, not guessed: the
    // identical gesture against a freshly loaded /issues moved the
    // row every time, and against a just-created board never did.
    // A reload is the honest way to say "start from what the server
    // thinks", and it is also what a person does without noticing.
    await settle(page);
    await page.reload();
    await settle(page);

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
    await settle(page);
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
    //
    // Deleting an issue goes through the app's own ConfirmDialog —
    // role="dialog", aria-modal — not window.confirm. A
    // page.on("dialog") handler is therefore useless here and the
    // first version of this cleanup used one, clicked the bin, and
    // waited thirty seconds for a row that was never going anywhere.
    for (const title of titles) {
      const row = page.getByRole("article").filter({ hasText: title });
      await row.getByRole("button", { name: /delete this issue/i }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(row).toHaveCount(0, { timeout: 30_000 });
    }
  });

  test("companies can be reordered, and the order is the instance's", async ({
    page,
  }) => {
    // THE TWO FIXTURE COMPANIES, never a real one (docs/e2e.md). This
    // used to move whichever company was first, a client's. seed:e2e
    // puts E2E Fixture Co and E2E Fixture Co 2 next to each other at
    // the end of the list; this swaps them, checks no other company's
    // place changed, and swaps them back whatever happens.
    const FIX_1 = FIXTURE_COMPANY_NAME;
    const FIX_2 = `${FIXTURE_COMPANY_NAME} 2`;
    const others = (order: string[]) => order.filter((n) => n !== FIX_1 && n !== FIX_2);

    await signIn(page, users.admin());
    await page.goto("/admin/companies");

    const before = await companyOrder(page);
    expect(before, "seed:e2e has not made E2E Fixture Co 2").toContain(FIX_2);
    expect(
      before.indexOf(FIX_2) - before.indexOf(FIX_1),
      "the two fixtures must sit next to each other (seed:e2e)"
    ).toBe(1);

    try {
      // A normal drag: the second fixture up one place.
      await keyboardDragUp(page, new RegExp(`reorder ${escapeRe(FIX_2)}`, "i"));
      await expect
        .poll(async () => {
          const now = await companyOrder(page);
          return now.indexOf(FIX_2) === before.indexOf(FIX_1) && now.indexOf(FIX_1) === before.indexOf(FIX_2);
        }, { timeout: 15_000 })
        .toBe(true);

      // Persisted, not just reordered in this tab: sort_order is a
      // column on the company row (0203), so a reload is the test.
      await settle(page);
      await page.reload();
      const after = await companyOrder(page);
      expect(after.indexOf(FIX_2), "the new order was not saved").toBe(before.indexOf(FIX_1));
      expect(after.indexOf(FIX_1), "the new order was not saved").toBe(before.indexOf(FIX_2));
      // And no other company moved.
      expect(others(after), "another company's place changed").toEqual(others(before));
    } finally {
      // PUT IT BACK, even when the test failed: drag the second fixture
      // down again if it is still above the first.
      await page.goto("/admin/companies");
      const now = await companyOrder(page);
      if (now.indexOf(FIX_2) < now.indexOf(FIX_1)) {
        await keyboardDrag(page, new RegExp(`reorder ${escapeRe(FIX_2)}`, "i"));
        await settle(page);
        await page.reload();
      }
      await expect
        .poll(async () => await companyOrder(page), { timeout: 30_000 })
        .toEqual(before);
    }
  });
});

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
