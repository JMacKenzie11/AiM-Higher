import { test, expect, signIn, users, openPlanAdd } from "./fixtures";
import type { Page } from "@playwright/test";

// Two things a company admin does to a focus area on /plan, walked
// in a browser (Jason, 2026-11-12, from B&B Electric's quarter roll):
//
//   1. drag it up or down by the handle on its row, and
//   2. archive it, which takes its COMPLETED goals with it and
//      leaves a goal still in progress on the plan.
//
// The unit tests pin the arithmetic and the filters. This is the
// only test that would catch a handle that folds the card it sits
// in (the row is a <summary>), or a finished goal still listed under
// "Goals without a focus area".
//
// Creates its own rows and archives them again, per docs/e2e.md,
// and sweeps anything an earlier run left behind before it starts.

const PREFIX = "E2E order ";

// A card is found by its own title link, never by hasText: see
// e2e/priority-under-focus-area.spec.ts.
function sfaCard(page: Page, title: string) {
  return page
    .locator("details[data-sfa-id]")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

async function archiveFromDetail(page: Page) {
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/, { timeout: 30_000 });
}

async function sweep(page: Page) {
  for (let i = 0; i < 12; i += 1) {
    await page.goto("/plan");
    const leftover = page
      .getByRole("link", { name: new RegExp(`^${PREFIX}`) })
      .first();
    if ((await leftover.count()) === 0) return;
    await leftover.click();
    await archiveFromDetail(page);
  }
}

// One step of a keyboard drag: pick up, move, drop. The keyboard
// gesture and the waits between the keys are deliberate; see
// e2e/reorder.spec.ts, which this is copied from.
async function keyboardMove(
  page: Page,
  handleLabel: string,
  direction: "ArrowDown" | "ArrowUp"
) {
  const handle = page.getByRole("button", { name: handleLabel, exact: true });
  await expect(handle).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await handle.scrollIntoViewIfNeeded();
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press(direction);
  await page.waitForTimeout(300);
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.request().headers()["next-action"] !== undefined,
    { timeout: 30_000 }
  );
  await page.keyboard.press("Space");
  const response = await saved;
  expect(response.ok(), "the reorder save failed").toBe(true);
}

// The order our two cards sit in, read off the page.
async function ourOrder(page: Page, titles: string[]) {
  const all = await page
    .locator("details[data-sfa-id] > summary a")
    .allTextContents();
  return all.map((t) => t.trim()).filter((t) => titles.includes(t));
}

test("focus areas reorder by their drag handles, and an archived one takes its finished goals", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const first = `${PREFIX}first ${stamp}`;
  const second = `${PREFIX}second ${stamp}`;
  const doneGoal = `${PREFIX}goal done ${stamp}`;
  const liveGoal = `${PREFIX}goal live ${stamp}`;

  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^E2E Fixture Co$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  await sweep(page);

  for (const title of [first, second]) {
    const addSfa = await openPlanAdd(page, "sfa");
    await addSfa.getByLabel("Title").fill(title);
    await addSfa
      .getByRole("button", { name: "Add Focus Area", exact: true })
      .click();
    await expect(sfaCard(page, title)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("drawer-panel")).toBeHidden({
      timeout: 15_000,
    });
  }

  // ---- The drag handles --------------------------------------
  // Created first, shown first.
  expect(await ourOrder(page, [first, second])).toEqual([first, second]);

  await keyboardMove(page, `Reorder ${second}`, "ArrowUp");
  await expect
    .poll(() => ourOrder(page, [first, second]), { timeout: 30_000 })
    .toEqual([second, first]);
  // Using the handle moved the card and did not fold it: the handle
  // sits in the card's <summary>.
  await expect(sfaCard(page, second)).toHaveAttribute("open", "");

  // It is stored, not a trick of the page: still so after a reload.
  await page.reload();
  expect(await ourOrder(page, [first, second])).toEqual([second, first]);

  await keyboardMove(page, `Reorder ${second}`, "ArrowDown");
  await expect
    .poll(() => ourOrder(page, [first, second]), { timeout: 30_000 })
    .toEqual([first, second]);

  // ---- Two goals under the first: one finished, one not --------
  const fa = sfaCard(page, first);
  for (const title of [doneGoal, liveGoal]) {
    const addGoal = fa.getByTestId("sfa-add-goal-panel");
    if (!(await addGoal.getByLabel("Title").isVisible())) {
      await addGoal.locator("summary").click();
    }
    await addGoal.getByLabel("Title").fill(title);
    await addGoal.getByRole("button", { name: "Add goal", exact: true }).click();
    await expect(
      fa.getByRole("link", { name: title, exact: true })
    ).toBeVisible({ timeout: 30_000 });
  }

  await page.getByRole("link", { name: doneGoal, exact: true }).click();
  await page.getByRole("button", { name: "Mark complete", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Complete it", exact: true })
    .click();
  // Once complete the page stops offering to complete it.
  await expect(
    page.getByRole("button", { name: "Mark complete", exact: true })
  ).toHaveCount(0, { timeout: 30_000 });

  // ---- Archive the focus area ---------------------------------
  await page.goto("/plan");
  await page.getByRole("link", { name: first, exact: true }).click();
  await archiveFromDetail(page);

  await expect(page.getByRole("link", { name: first, exact: true })).toHaveCount(0);
  // The goal still in progress stays, under the standalone heading.
  const orphans = page.getByRole("region", {
    name: "Goals without a focus area",
  });
  await expect(
    orphans.getByRole("link", { name: liveGoal, exact: true })
  ).toBeVisible({ timeout: 30_000 });
  // The finished one went with its focus area.
  await expect(page.getByRole("link", { name: doneGoal, exact: true })).toHaveCount(0);

  // ---- Leave nothing behind -----------------------------------
  await sweep(page);
});
