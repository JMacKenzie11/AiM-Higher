import { test, expect, signIn, users } from "./fixtures";

// The commitment link chip, on a phone.
//
// Two separate defects, both invisible to a unit test and both
// invisible at desktop width:
//
//   the chip clipped mid-word   `.chip` is display: inline-flex and
//                               the label was a bare text node — an
//                               anonymous flex item, which
//                               text-overflow has no block box to
//                               act on. One Benson priority put
//                               968px of text in a 139px chip and
//                               stopped at "Refer a friend progr".
//
//   the menu left the screen    `left: 0` of a chip at x=142 with
//                               `min-width: 260px` ran to x=402 on a
//                               393px viewport and took the document
//                               to 465px wide — the whole page
//                               scrolling sideways for a dropdown.
//
// EVERY CHIP, not the first one. The first chip fitting says nothing
// about one further right, and the failing attempts at this fix each
// looked correct on one row and wrong on another.

test("the link chip and its menu stay on a phone screen", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  await page.goto("/commitments", { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname, "must be on /commitments").toBe(
    "/commitments"
  );
  await page.waitForTimeout(1500);

  const chips = page.locator('button[class*="chip"]');
  const count = await chips.count();
  expect(count, "Benson has linked commitments to look at").toBeGreaterThan(0);

  // ---- the label ellipsises rather than clipping ----------------
  const labels = (await page.evaluate(`(() => {
    const out = [];
    for (const chip of Array.from(document.querySelectorAll('button[class*="chip"]'))) {
      const label = chip.querySelector('[class*="chipLabel"]');
      if (!label) { out.push({ missing: true }); continue; }
      const s = getComputedStyle(label);
      out.push({
        missing: false,
        ellipsis: s.textOverflow,
        overflow: s.overflow,
        truncated: label.scrollWidth > Math.ceil(label.getBoundingClientRect().width) + 1,
      });
    }
    return out;
  })()`)) as Array<{ missing: boolean; ellipsis: string; truncated: boolean }>;

  expect(
    labels.filter((l) => l.missing),
    "every chip wraps its label in an element that can ellipsise"
  ).toEqual([]);
  for (const l of labels) expect(l.ellipsis).toBe("ellipsis");
  // At this width at least one title is long enough to need it —
  // otherwise this test is passing on data that cannot fail it.
  expect(
    labels.some((l) => l.truncated),
    "at least one title is long enough to be truncated"
  ).toBe(true);

  // ---- the menu stays inside the viewport, from every chip -------
  const offscreen: string[] = [];
  for (let i = 0; i < Math.min(count, 8); i++) {
    const chip = chips.nth(i);
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await page.waitForTimeout(350);
    const m = (await page.evaluate(`(() => {
      const el = document.querySelector('[role="menu"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x), right: Math.round(r.right),
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        vw: window.innerWidth, vh: window.innerHeight,
        docW: document.documentElement.scrollWidth,
      };
    })()`)) as {
      x: number; right: number; top: number; bottom: number;
      vw: number; vh: number; docW: number;
    } | null;
    if (!m) {
      offscreen.push(`chip ${i}: menu did not open`);
    } else if (
      m.x < 0 || m.right > m.vw || m.top < 0 || m.bottom > m.vh ||
      m.docW > m.vw
    ) {
      offscreen.push(`chip ${i}: ${JSON.stringify(m)}`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  expect(offscreen, "menus that left the screen").toEqual([]);
});
