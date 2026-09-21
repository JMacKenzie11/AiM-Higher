import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// NO PAGE MAY SCROLL SIDEWAYS ON A PHONE.
//
// ---- WHY THIS IS A STANDING CHECK AND NOT A FIX -----------------
//
// Three separate instances of one root cause turned up in a single
// session, on three different surfaces:
//
//   /measures   the drawn scrollbar was inset by the pinned block,
//               about 770px, putting a button at x=828
//   every page  PageShell's hero cancelled a 24px gutter that had
//               become 16px on a phone, overhanging 8px a side
//   /plan       a <select> sized to its widest <option>, which is a
//               priority title; 157 characters rendered it 961px and
//               took the page to 1088px
//
// Every one of them is the same shape: something sizes to its
// content, and a flex ancestor defaults to `min-width: auto` — its
// MIN-CONTENT width — so nothing in the chain is allowed to shrink
// and the overflow escapes to the document.
//
// The damage is never confined to the element. A document wider than
// the viewport moves every `position: fixed` panel in the app,
// because `right: 0` resolves against the document: that is how a
// too-wide select on /plan and a too-wide scrollbar on /measures
// both ended up clipping the add drawer's labels off the screen.
//
// ---- WHY IT CANNOT BE A UNIT TEST -------------------------------
//
// The number that matters is `document.scrollWidth` on a rendered
// page at a phone viewport, with real content in it. /plan is the
// proof: the same code is clean for a company with short priority
// titles and broken for one with long ones. Nothing about the source
// distinguishes those two cases.
//
// So this scopes into a company whose content is known to be long
// enough to provoke it. Six of the nine companies in production have
// priority titles over 80 characters; Benson Seafood's longest is
// 157, and it is the one that found this.

// EVERY STATIC ROUTE IN THE APP, not a shortlist.
//
// It started as five pages, which is how /commitments went unchecked
// while it was 46px too wide. The routes with an [id] in them are
// missing and that is the known gap: they need a real row to point
// at, and discovering one per route is a different job from this.
// Everything reachable without one is here.
const PAGES = [
  "/dashboard",
  "/measures",
  "/plan",
  "/chart",
  "/commitments",
  "/issues",
  "/people",
  "/foundation",
  "/scorecard",
  "/quarters",
  "/leadership",
  "/profile",
  "/classroom",
  "/ask-aimee",
  "/ask-aimee/memory",
  "/strengths/results",
  "/strengths/teams",
  "/strengths/welcome",
  "/strengths/assessment",
  "/portfolio",
  "/hq",
  "/admin/companies",
  "/admin/dashboard",
  "/admin/transcripts",
  "/admin/classroom",
];

async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

// Named, not just counted. A bare "1088 > 393" sends the next person
// hunting; the element and its width start them where the problem is.
const OFFENDERS = `(() => {
  const d = document.documentElement, vw = d.clientWidth, out = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= vw + 1) continue;
    // Something inside a scroll container is meant to be wider.
    let clipped = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") { clipped = true; break; }
    }
    if (!clipped) {
      out.push(el.tagName + "." + String(el.className).slice(0, 40) +
               " width=" + Math.round(r.width) + " right=" + Math.round(r.right));
    }
  }
  return { vw: vw, scrollW: d.scrollWidth, offenders: out.slice(-5) };
})()`;

type Result = { vw: number; scrollW: number; offenders: string[] };

test("@prod no page scrolls sideways on a phone", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await scopeIn(page);

  const broken: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    const r = (await page.evaluate(OFFENDERS)) as Result;
    // Where it ACTUALLY landed. A gated route redirects, and counting
    // a redirect as coverage of the route asked for is how a page
    // goes unchecked while the suite looks thorough.
    const landed = new URL(page.url()).pathname;
    const where = landed === path ? path : `${path} → ${landed}`;
    if (r.scrollW > r.vw) {
      broken.push(`${where}: ${r.scrollW} > ${r.vw} — ${r.offenders.join(" | ")}`);
    }
  }

  // All pages in one assertion, so one run names every broken page
  // rather than stopping at the first.
  expect(broken, "these pages scroll sideways at 393px").toEqual([]);
});
