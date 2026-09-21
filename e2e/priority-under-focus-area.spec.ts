import { test, expect, signIn, users, openPlanAdd } from "./fixtures";
import type { Page } from "@playwright/test";

// A DISCLOSURE IS SELECTED AS A <summary>, NEVER BY ITS TEXT.
//
// Every add panel has a summary that opens it and a submit button
// that commits it, and since the labels lost their typed "+" the two
// differ only by capitalisation — which getByText ignores. Selecting
// the element type says which one is meant and survives the next
// copy change.

// A quarterly priority hanging straight off a focus area, walked
// end to end (migration 0209).
//
// The unit tests pin the RULES — one parent, both columns written,
// where each row buckets. This walks the thing a person actually
// does, across the four surfaces the change touches: the grouped
// parent picker, the cascade, the priority page, and the focus area
// page. It is the only test that would have caught a picker whose
// option values the server action cannot parse, because every layer
// of that is green in isolation.
//
// Creates its own rows and archives them again, per docs/e2e.md,
// and sweeps anything an earlier run left behind before it starts.

// A CASCADE CARD IS FOUND BY ITS OWN TITLE LINK, NEVER BY hasText:
// every focus-area card carries an add form whose parent picker
// lists EVERY focus area by name, so each card's text contains every
// other card's title. See e2e/plan-anchor.spec.ts, where that cost
// an afternoon.

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
      .getByRole("link", { name: /^E2E walk / })
      .first();
    if ((await leftover.count()) === 0) return;
    await leftover.click();
    await archiveFromDetail(page);
  }
}

test("a priority under a focus area, end to end", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const faTitle = `E2E walk fa ${stamp}`;
  const goalTitle = `E2E walk goal ${stamp}`;
  const priTitle = `E2E walk priority ${stamp}`;

  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^E2E Fixture Co$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  await sweep(page);

  // ---- Focus area -------------------------------------------
  const addSfa = await openPlanAdd(page, "sfa");
  await addSfa.getByLabel("Title").fill(faTitle);
  await addSfa.getByRole("button", { name: "Add Focus Area", exact: true }).click();
  const fa = sfaCard(page, faTitle);
  await expect(fa).toBeVisible({ timeout: 30_000 });

  // ---- A goal under it, so the focus area holds BOTH -----------
  // Goals and direct priorities are peers, and "both at once" is the
  // normal case rather than an edge — a focus area may hold either
  // or both.
  const addGoal = fa.getByTestId("sfa-add-goal-panel");
  await addGoal.locator("summary").click();
  await addGoal.getByLabel("Title").fill(goalTitle);
  await addGoal.getByRole("button", { name: "Add goal", exact: true }).click();
  await expect(
    fa.getByRole("link", { name: goalTitle, exact: true })
  ).toBeVisible({ timeout: 30_000 });

  // ---- The grouped parent picker on the toolbar panel --------
  const addPriorityToolbar = await openPlanAdd(page, "priority");
  const parentPicker = addPriorityToolbar.getByLabel("Parent");
  await expect(parentPicker).toBeVisible();
  // Both levels, grouped, in one control.
  const groups = await parentPicker
    .locator("optgroup")
    .evaluateAll((els) => els.map((e) => e.getAttribute("label")));
  expect(groups).toEqual(["Goals", "Focus areas"]);

  // The option's VALUE is the wire form the server action parses.
  // If these two ever disagree the screen looks right and the row is
  // wrong, so assert the shape rather than trusting the label.
  const faOption = await parentPicker
    .locator(`optgroup[label="Focus areas"] option`)
    .filter({ hasText: faTitle })
    .getAttribute("value");
  expect(faOption).toMatch(/^sfa:[0-9a-f-]{36}$/);
  // Shut the drawer again before touching the cascade underneath it:
  // it is modal, with a scrim over the page.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("drawer-panel")).toBeHidden({
    timeout: 15_000,
  });

  // ---- Add a priority straight under the focus area ----------
  const addPriority = fa.getByTestId("sfa-add-priority-panel");
  await addPriority
    .locator("summary")
    .click();
  await addPriority.getByLabel("Title").fill(priTitle);
  // The parent is implied by where we clicked, so there is no picker.
  await expect(addPriority.getByLabel("Parent")).toHaveCount(0);
  await addPriority.getByRole("button", { name: /Add quarterly priority/i }).click();

  const priLink = page.getByRole("link", { name: priTitle, exact: true });
  await expect(priLink).toBeVisible({ timeout: 30_000 });

  // It renders INSIDE the focus area card, and NOT in the standalone
  // section at the bottom.
  await expect(fa.getByRole("link", { name: priTitle, exact: true })).toHaveCount(1);
  const standalone = page
    .getByRole("region", { name: /Standalone/i })
    .getByRole("link", { name: priTitle, exact: true });
  await expect(standalone).toHaveCount(0);

  // ---- No duplicate ids on a page full of add forms ----------
  // /plan renders these forms many times over: once in the toolbar,
  // once per focus area, once per goal. Fixed field ids put several
  // elements with the same id in one document — invalid HTML, and it
  // breaks the thing the id is for, because <label htmlFor> resolves
  // to the FIRST match and clicking a field's label focuses another
  // form's field. `useId` scopes them; this is the assertion that
  // says so out loud.
  const duplicateIds = await page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of Array.from(document.querySelectorAll("[id]"))) {
      seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(duplicateIds).toEqual([]);

  // ---- The priority detail page ------------------------------
  await priLink.click();
  await expect(page).toHaveURL(/\/plan\/priority\//, { timeout: 30_000 });
  await expect(page.getByText(`Focus area: ${faTitle}`)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Back to focus area/i })
  ).toBeVisible();

  // The back link lands on /plan, positioned on the focus area.
  await page.getByRole("link", { name: /Back to focus area/i }).click();
  await expect(page).toHaveURL(/\/plan#sfa-/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: faTitle, exact: true })).toBeInViewport();

  // ---- The focus area detail page ----------------------------
  await page.getByRole("link", { name: faTitle, exact: true }).click();
  await expect(page).toHaveURL(/\/plan\/sfa\//, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: /Goals and priorities under this focus area/i })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: priTitle, exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: goalTitle, exact: true })
  ).toBeVisible();

  // ---- Clean up ----------------------------------------------
  await page.goto("/plan");
  await priLink.click();
  await archiveFromDetail(page);
  await sweep(page);
  await expect(page.getByRole("link", { name: /^E2E walk / })).toHaveCount(0);
});
