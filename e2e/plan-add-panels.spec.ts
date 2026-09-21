import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// The add controls on the plan surfaces: the button must not move when
// its panel opens, only one panel may be open, and on a phone the four
// toolbar adds hide behind one Add.
//
// All three have regressed before, and none of them is visible to a
// unit test — they are layout and native <details> behaviour.
//
// The first two are about the SFA DETAIL page, which still uses
// <details> panels. The toolbar's four became one drawer; what is
// pinned there is that the four BUTTONS still collapse behind one Add
// on a phone, which is a separate concern from how a panel opens and
// did not change with the drawer.
//
// THE PILL IS MEASURED INSIDE ITS ROW, not the viewport. Clicking a
// <summary> can scroll it into view, which moves a viewport-relative
// box without anything having reflowed; the first version of this
// measurement reported a 252px "jump" that was the page scrolling.

async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

test("an open add panel leaves its button where it was", async ({ page }) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.goto("/plan");
  const card = page.locator("details[data-sfa-id]").first();
  const href = await card.locator("summary a").first().getAttribute("href");
  await page.goto(href!);

  const goal = page.getByTestId("sfa-add-goal-panel");
  const priority = page.getByTestId("sfa-add-priority-panel");
  await expect(goal).toBeVisible({ timeout: 30_000 });

  const pillPosition = () =>
    priority.locator("summary").evaluate((el: Element) => {
      const e = el as HTMLElement;
      return { left: e.offsetLeft, top: e.offsetTop };
    });

  const atRest = await pillPosition();

  // Opening the FIRST control must not push the second one anywhere.
  // It used to: the panel lived in flow inside the <details>, so the
  // only way to give the form the row's width was to stretch the
  // <details>, which dragged its own button along with it.
  await goal.locator("summary").click();
  expect(await pillPosition()).toEqual(atRest);

  // And opening the second leaves it where it is too.
  await priority.locator("summary").click();
  expect(await pillPosition()).toEqual(atRest);

  // Only one at a time, via the native `name` grouping on <details>.
  expect(
    await goal.evaluate((e: Element) => (e as HTMLDetailsElement).open)
  ).toBe(false);
  expect(
    await priority.evaluate((e: Element) => (e as HTMLDetailsElement).open)
  ).toBe(true);
});

test("the four toolbar adds hide behind one Add on a phone", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page);

  // 430px, a real phone width. The bug this pins was reported from a
  // device and not caught here, because the media block sat ABOVE the
  // rules it overrides and a media query adds no specificity — the
  // plain `display: flex` won and the buttons never hid.
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/plan");
  const four = page.getByTestId("add-sfa-button");
  const trigger = page.getByRole("button", { name: "Add", exact: true });
  await expect(trigger).toBeVisible({ timeout: 30_000 });

  await expect(four).toBeHidden();
  await trigger.click();
  await expect(four).toBeVisible();
  await trigger.click();
  await expect(four).toBeHidden();

  // Desktop keeps all four and never shows the trigger: there is room
  // for them there, and a menu would only be a click tax.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/plan");
  await expect(four).toBeVisible({ timeout: 30_000 });
  await expect(trigger).toBeHidden();
});

// Its own test, loaded straight at desktop width.
//
// The assertion above lives at the end of a test that starts on a
// phone, and it passed while the trigger was in fact showing for
// every desktop user — the page had been rendered at 430px first.
// Landing on /plan cold at 1280 is the case a person actually has.
test("the mobile Add trigger is not on the desktop toolbar", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await scopeIn(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/plan");
  await expect(page.getByTestId("add-sfa-button")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeHidden();
});
