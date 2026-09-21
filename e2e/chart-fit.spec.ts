import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// The org chart canvas is the size of the chart in it.
//
// `.tree` was a fixed `min(70vh, 720px)` whatever the chart's shape.
// Measured on Benson at 393px, the tree drew 145px tall inside a
// 596px frame: 451px of empty card under the chart, which is most of
// what you saw on a phone.
//
// The frame now takes its height from the tree it just fitted. What
// is asserted here is the RELATIONSHIP — frame ≈ drawn chart + its
// padding — rather than any particular number, because the numbers
// are properties of whatever Benson's chart looks like this week.
//
// Desktop is asserted too, and asserted to be UNCHANGED. On a wide
// screen the tree is tall enough to fill the frame, so the height was
// binding before and still is; this test is what says so if the fit
// maths is touched again.

const SIZES = [
  { width: 393, height: 852, label: "phone" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1280, height: 900, label: "laptop" },
];

type Shot = {
  frameH: number;
  drawnH: number;
  deadV: number;
  scale: number;
  docW: number;
  vw: number;
};

const MEASURE = `(() => {
  const frame = document.querySelector('[class*="panZoomFrame"]');
  const content = document.querySelector('[class*="panZoomContent"]');
  const inner = content ? content.firstElementChild : null;
  if (!frame || !content || !inner) return null;
  const fr = frame.getBoundingClientRect();
  const ir = inner.getBoundingClientRect();
  const m = new DOMMatrix(getComputedStyle(content).transform);
  return {
    frameH: Math.round(fr.height),
    drawnH: Math.round(ir.height),
    deadV: Math.round(fr.height - ir.height),
    scale: Number(m.a.toFixed(3)),
    docW: document.documentElement.scrollWidth,
    vw: window.innerWidth,
  };
})()`;

async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

test("the chart canvas is the size of the chart in it", async ({ page }) => {
  test.setTimeout(300_000);
  await scopeIn(page);

  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/chart", { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname, "must be on /chart").toBe("/chart");
    // The fit runs on a double rAF after mount and again on resize.
    await expect
      .poll(
        async () => ((await page.evaluate(MEASURE)) as Shot | null)?.frameH ?? 0,
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);
    await page.waitForTimeout(600);

    const m = (await page.evaluate(MEASURE)) as Shot;
    console.log(size.label, JSON.stringify(m));

    // The chart is actually drawn.
    expect(m.drawnH, `${size.label}: nothing drawn`).toBeGreaterThan(0);

    // And the frame is not mostly empty. 96px is generous — the fit
    // padding is 12 a side on a phone and 32 on a desktop, so this
    // fails long before anyone would call it "drowning in the card"
    // and does not fail on a deep chart that legitimately fills the
    // frame.
    expect(
      m.deadV,
      `${size.label}: ${m.deadV}px of empty canvas under the chart`
    ).toBeLessThanOrEqual(96);

    // The canvas never drives the page sideways.
    expect(m.docW, `${size.label} scrolls sideways`).toBeLessThanOrEqual(m.vw);

    // And the chart is never scaled to nothing. 0.15 is the library's
    // own minScale; hitting it means the fit gave up.
    expect(m.scale, `${size.label}: chart scaled to ${m.scale}`).toBeGreaterThan(
      0.15
    );
  }
});
