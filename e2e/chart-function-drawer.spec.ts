import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// Editing a function happens on the chart now.
//
// What is pinned here is what a unit test structurally cannot see:
//
//   * a card click opens the panel and does NOT navigate. The whole
//     point of the change is that the chart is still behind it, in
//     the place you left it, so the URL staying on /chart is the
//     assertion that the feature exists at all;
//   * the panel is a child of <body>. /chart's pan-and-zoom canvas
//     carries a transform, and a `position: fixed` panel declared
//     inside it resolves against the canvas rather than the
//     viewport. That is the incident Drawer.tsx portals to avoid,
//     and this is the surface where it bites hardest;
//   * an edit made inside the panel reaches the card behind it.
//     DraggableTree copied `roots` into state once at mount and
//     ignored the prop forever after, which was invisible while a
//     drag was the only writer and is not now;
//   * the panel is fed by a fetch rather than the RSC tree, so
//     switching functions has to clear what it was showing. Opening
//     a second card must not spend the fetch showing the first;
//   * nothing in the panel sits under the help widget. *Delete
//     function* did, on the first pass: it inherited `.dangerZone`,
//     which is right-aligned, and the `?` bubble is fixed in that
//     corner at z-index 100. Same incident as /issues' clarity
//     panel, same check as the one in clarity-drawer.spec.ts;
//   * a function can be moved under a different parent, and the
//     picker never offers the function itself. The refusal for a
//     descendant is unit-tested in descendants.test.ts, because the
//     picker is what stops anybody reaching it in a browser.

async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

test("a function opens in a drawer over the chart, not on its own page", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.goto("/chart");

  const panel = page.getByTestId("drawer-panel").and(page.locator('[data-drawer-name="chart-function"]'));
  await expect(panel).toBeHidden();

  const cards = page.getByTestId("function-card-button");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  const cardCount = await cards.count();
  expect(cardCount, "the fixture chart has functions to click").toBeGreaterThan(
    0
  );

  const firstTitle = (await cards.first().locator("h3").textContent())?.trim();
  expect(firstTitle).toBeTruthy();

  // ---- Opens without leaving /chart ---------------------------
  await cards.first().click();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).pathname, "still on the chart").toBe("/chart");

  // ---- Outside the transformed canvas -------------------------
  expect(
    await panel.evaluate((el: Element) => el.parentElement === document.body)
  ).toBe(true);

  // Finished sliding. Read mid-animation this is a few hundred px out.
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.x), {
      timeout: 10_000,
    })
    .toBeLessThan(Math.round((await page.viewportSize())!.width));

  // ---- It is the function that was clicked --------------------
  await expect(panel.getByRole("button", { name: firstTitle! })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    panel.getByRole("heading", { name: /in the seat/i })
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: /roles & responsibilities/i })
  ).toBeVisible();

  // ---- Nothing in it hides under the help widget --------------
  const overlap = (await page.evaluate(`(() => {
    const help = document.querySelector('button[aria-label="Open help"], button[aria-label="Close help"]');
    if (!help) return "no help widget on the page";
    const h = help.getBoundingClientRect();
    const panel = document.querySelector('[data-drawer-name="chart-function"][role="dialog"]');
    if (!panel) return "no function drawer on the page";
    const hit = [];
    for (const b of Array.from(panel.querySelectorAll("button, a"))) {
      const r = b.getBoundingClientRect();
      if (r.width === 0) continue;
      const clash =
        r.left < h.right && r.right > h.left &&
        r.top < h.bottom && r.bottom > h.top;
      if (clash) hit.push((b.textContent || "").trim() || b.getAttribute("aria-label"));
    }
    return hit;
  })()`)) as string[] | string;
  expect(overlap, "drawer controls sit under the help widget").toEqual([]);

  // ---- Escape closes, chart still there -----------------------
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });
  expect(new URL(page.url()).pathname).toBe("/chart");
});

test("a rename in the drawer reaches the card behind it", async ({ page }) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.goto("/chart");

  const panel = page.getByTestId("drawer-panel").and(page.locator('[data-drawer-name="chart-function"]'));
  const cards = page.getByTestId("function-card-button");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });

  const original = (await cards.first().locator("h3").textContent())!.trim();
  const renamed = `${original} ✎`;

  await cards.first().click();
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // The drawer's head IS the rename control, the way the detail
  // page's H1 is.
  const titleButton = panel.getByRole("button", { name: original });
  await expect(titleButton).toBeVisible({ timeout: 30_000 });
  await titleButton.click();
  const titleInput = panel.getByLabel("Function name");
  await titleInput.fill(renamed);
  await titleInput.press("Enter");

  // The panel's own copy follows immediately; the card behind it
  // follows the router refresh.
  await expect(panel.getByRole("button", { name: renamed })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("function-card-button").first().locator("h3")
  ).toHaveText(renamed, { timeout: 30_000 });

  // ---- Put it back --------------------------------------------
  await panel.getByRole("button", { name: renamed }).click();
  const back = panel.getByLabel("Function name");
  await back.fill(original);
  await back.press("Enter");
  await expect(panel.getByRole("button", { name: original })).toBeVisible({
    timeout: 30_000,
  });
});

test("switching functions in the drawer does not show the last one", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.goto("/chart");

  const panel = page.getByTestId("drawer-panel").and(page.locator('[data-drawer-name="chart-function"]'));
  const cards = page.getByTestId("function-card-button");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });

  const count = await cards.count();
  test.skip(count < 2, "needs two functions on the chart to switch between");

  const firstTitle = (await cards.nth(0).locator("h3").textContent())!.trim();
  const secondTitle = (await cards.nth(1).locator("h3").textContent())!.trim();
  test.skip(
    firstTitle === secondTitle,
    "needs two differently-named functions"
  );

  await cards.nth(0).click();
  await expect(panel.getByRole("button", { name: firstTitle })).toBeVisible({
    timeout: 30_000,
  });

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });

  await cards.nth(1).click();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  // The one that was showing a moment ago must be gone, not still
  // there under the new heading while the fetch lands.
  await expect(panel.getByRole("button", { name: firstTitle })).toBeHidden();
  await expect(panel.getByRole("button", { name: secondTitle })).toBeVisible({
    timeout: 30_000,
  });
});

test("a function can be moved to a different parent", async ({ page }) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.goto("/chart");

  const addPanel = page
    .getByTestId("drawer-panel")
    .and(page.locator('[data-drawer-name="chart-add-function"]'));
  const panel = page
    .getByTestId("drawer-panel")
    .and(page.locator('[data-drawer-name="chart-function"]'));
  const title = `E2E move ${Date.now()}`;

  // A throwaway at top level, so the move is visible and nothing a
  // company depends on is rearranged to prove a point.
  await page.getByTestId("add-function-button").click();
  await addPanel.getByLabel(/function title/i).fill(title);
  await addPanel.getByRole("button", { name: /^Add function$/ }).click();
  await expect(addPanel).toBeHidden({ timeout: 30_000 });

  const card = page
    .getByTestId("function-card-button")
    .filter({ hasText: title });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // Top level says so, rather than saying nothing.
  await expect(panel.getByText("Top level.")).toBeVisible();

  await panel
    .getByRole("button", { name: /change where this function sits/i })
    .click();
  const select = panel.getByLabel("Sits under");
  await expect(select).toBeVisible({ timeout: 10_000 });

  // The function is not offered as its own parent. The database has
  // no constraint against it, and a function that is its own parent
  // is unreachable from any root: it vanishes off the chart.
  const options = await select.locator("option").allTextContents();
  expect(options.some((o) => o.includes(title))).toBe(false);
  expect(options[0]).toMatch(/top level/i);

  await select.selectOption({ label: "Visionary" });

  await expect(panel.getByRole("button", { name: "Visionary" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(panel.getByText("Top level.")).toBeHidden();

  // ---- Clean up, through the UI -------------------------------
  await panel.getByRole("button", { name: /delete function/i }).click();
  await page.getByTestId("confirm-accept").click();
  await expect(card).toBeHidden({ timeout: 30_000 });
});
