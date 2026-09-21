import { test, expect, signIn, users, openPlanAdd } from "./fixtures";
import type { Page } from "@playwright/test";

// The /plan toolbar's add controls, which are one drawer now.
//
// What is pinned here is the part that is easy to regress and
// invisible to a unit test:
//
//   * the drawer is a child of <body>, not of the toolbar card, which
//     is what makes `position: fixed` mean the viewport rather than
//     whichever ancestor carries a transform;
//   * there is ONE panel whose contents change, so "only one open at
//     a time" — the original complaint about this toolbar — is not a
//     rule anybody has to implement. The drawer is modal, so the
//     toolbar is behind its scrim: you close it and open the next,
//     which is why the switches below press Escape first;
//   * the forms are never unmounted. That is not a nicety: the add
//     forms call router.refresh() in an effect on success, and an
//     earlier attempt to own these panels in React state discarded an
//     in-flight refresh so the created row never appeared. The
//     <details> they replaced kept their children mounted; so does
//     this. See PlanAddDrawers and AddPanels.

async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

test("the plan adds open one drawer, outside the page's layout", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.goto("/plan");

  const panel = page.getByTestId("drawer-panel");
  await expect(panel).toBeHidden();

  // ---- Opens, and is a child of body -------------------------
  const sfaForm = await openPlanAdd(page, "sfa");
  await expect(panel).toBeVisible();
  expect(
    await panel.evaluate((el: Element) => el.parentElement === document.body)
  ).toBe(true);

  // Finished sliding. Read mid-animation this is a few hundred px out.
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.x), {
      timeout: 10_000,
    })
    .toBeLessThan(Math.round((await page.viewportSize())!.width));

  await expect(sfaForm.getByLabel("Future-perfect narrative")).toBeVisible();

  // ---- A second add reuses the same panel ---------------------
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });
  const goalForm = await openPlanAdd(page, "goal");
  await expect(goalForm).toBeVisible();
  await expect(sfaForm).toBeHidden();
  // Still exactly one panel, not two stacked.
  await expect(page.getByTestId("drawer-panel")).toHaveCount(1);

  // ---- The forms are not unmounted ----------------------------
  // Typed text survives switching away and back. If the drawer
  // unmounted its children this would come back empty — and so would
  // an in-flight router.refresh().
  await goalForm.getByLabel("Title").fill("keep me");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });
  await openPlanAdd(page, "sfa");
  await expect(page.getByTestId("add-goal-form")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });
  await openPlanAdd(page, "goal");
  await expect(goalForm.getByLabel("Title")).toHaveValue("keep me");

  // ---- Closing returns focus to the trigger -------------------
  // A 150px button in a toolbar somebody would otherwise have to
  // find again with the keyboard.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("add-goal-button")).toBeFocused();

  // ---- The scrim closes it too --------------------------------
  await openPlanAdd(page, "sfa");
  await page.getByTestId("drawer-scrim").click();
  await expect(panel).toBeHidden({ timeout: 10_000 });
});

test("the closed drawer does not cover the page", async ({ page }) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/plan");

  // keepMounted leaves the scrim in the DOM permanently. It is
  // `hidden`, and .scrim sets position: fixed with inset: 0 — so if
  // `hidden` ever stopped hiding it, every click on this page would
  // land on an invisible sheet instead. Nothing about the page would
  // look wrong.
  const covered = await page.evaluate(() => {
    const top = document.elementFromPoint(
      Math.round(window.innerWidth / 2),
      Math.round(window.innerHeight / 2)
    );
    return String(top?.className).includes("scrim");
  });
  expect(covered, "the closed drawer's scrim is over the page").toBe(false);

  // And the page still does not scroll sideways with it there.
  const { w, v } = (await page.evaluate(
    "({w: document.documentElement.scrollWidth, v: document.documentElement.clientWidth})"
  )) as { w: number; v: number };
  expect(w).toBeLessThanOrEqual(v);
});

// /chart's Add function, which is the same drawer.
//
// keepMounted matters here for its own reason: AddFunctionForm does
// router.push to the new function's page in an effect on success, and
// unmounting the form as it succeeds is how that push gets thrown
// away. The <details> it replaced never unmounted anything either.
test("add function on /chart opens the same drawer", async ({ page }) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.goto("/chart");

  const panel = page.getByTestId("drawer-panel");
  await expect(panel).toBeHidden();

  await page.getByTestId("add-function-button").click();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  expect(
    await panel.evaluate((el: Element) => el.parentElement === document.body)
  ).toBe(true);
  await expect(
    page.getByTestId("add-function-form").getByLabel("Function title")
  ).toBeVisible();

  // The tree underneath is pan-and-zoom and carries a transform. That
  // is exactly the ancestor that breaks position: fixed for a child,
  // and the reason this panel is portalled rather than opened in
  // place: full viewport height, flush to the right edge.
  // The tree underneath is pan-and-zoom and carries a transform. That
  // is exactly the ancestor that breaks position: fixed for a child,
  // and the reason this panel is portalled rather than opened in
  // place: full viewport height, flush to the right edge.
  //
  // POLLED, because the panel slides in from translateX(100%). Read
  // on the first frame its right edge is a full panel width past the
  // viewport, which is what a plain boundingBox() reported the first
  // time this was written.
  const view = (await page.viewportSize())!;
  await expect
    .poll(async () => {
      const b = (await panel.boundingBox())!;
      return Math.round(b.x + b.width);
    }, { timeout: 10_000 })
    .toBe(view.width);
  expect(Math.round((await panel.boundingBox())!.height)).toBe(view.height);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("add-function-button")).toBeFocused();
});
