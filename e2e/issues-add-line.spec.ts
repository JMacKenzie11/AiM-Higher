import { test, expect, signIn, users } from "./fixtures";

// The add-a-commitment form inside an issue, on a phone.
//
// `.addLine` composes `row` from commitments.module.css, which at
// <= 1024px places a row's cells by POSITION:
// `.row > :nth-child(1..8) { grid-area: ... }`. That is safe only if
// you know the child count, and both stylesheets carried a comment
// saying the form has three hidden inputs before its first real cell.
//
// It has seven. Three are written in the JSX; the rest are added by
// React to a `<form action={serverAction}>` to encode the
// server-action reference. Every nth-child rule landed on a hidden
// input, the textarea fell through to :nth-child(8) and took
// `grid-area: status`, and the select, date and button kept their
// desktop columns 5, 6 and 7, which a four-column grid does not have:
//
//     grid-template-columns: 40px 40px 40px 0px 18px 158px 51px
//     textarea  w=18  h=461   "What will we do this week?"
//
// The description track collapsed and its placeholder rendered one
// letter per line, on every issue, for every Benson user on a phone.
// Failure mode E15.
//
// TAGGED @prod, AND IT WOULD FAIL WITHOUT THE TAG TOO. The original
// write-up of E15 claimed the count was three in `next dev` and seven
// in a build, so only a production run could see it. That was wrong —
// measured on both since, it is seven either way and the collapse
// reproduces in dev identically. The tag stays because this is a
// layout assertion and the production build is the artifact that
// ships, not because dev is blind to it.

test("@prod the issue add-commitment form is not crushed on a phone", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^Benson Seafood$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  await page.goto("/issues", { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname, "must be on /issues").toBe("/issues");

  // A 4xx on any app asset means React never hydrated and everything
  // below is a measurement of a page that is not the app. Four probes
  // reported a confident zero that way during the original hunt.
  const dead: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/_next/")) dead.push(r.url());
  });

  // Open every disclosure so the add forms render.
  for (let pass = 0; pass < 3; pass++) {
    const closed = page.locator('[aria-expanded="false"]');
    const n = await closed.count();
    for (let i = 0; i < n; i++) {
      await closed.nth(i).click({ timeout: 5000 }).catch(() => {});
    }
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1200);
  expect(dead, "app assets failed to load").toEqual([]);

  const forms = page.locator('textarea[aria-label="New commitment"]');
  const count = await forms.count();
  expect(count, "no add-commitment form on the page").toBeGreaterThan(0);

  const boxes = (await page.evaluate(`(() => {
    const out = [];
    for (const ta of Array.from(
      document.querySelectorAll('textarea[aria-label="New commitment"]')
    )) {
      const r = ta.getBoundingClientRect();
      const form = ta.closest("form");
      out.push({
        w: Math.round(r.width),
        h: Math.round(r.height),
        hiddenInputs: form
          ? form.querySelectorAll('input[type="hidden"]').length
          : -1,
        cols: form ? getComputedStyle(form).gridTemplateColumns : "",
      });
    }
    return out;
  })()`)) as Array<{ w: number; h: number; hiddenInputs: number; cols: string }>;

  console.log("ADD FORMS", JSON.stringify(boxes.slice(0, 3)));

  for (const b of boxes) {
    // 18px was the measured failure. 120 is comfortably above any
    // legitimate layout at 393px and far below the ~240 it should be,
    // so this fails on the bug and not on a font change.
    expect(
      b.w,
      `description input is ${b.w}px wide — the grid collapsed it`
    ).toBeGreaterThan(120);
    // A box taller than it is wide, at this width, is text running
    // down the page one letter at a time.
    expect(
      b.h,
      `description input is ${b.h}px tall against ${b.w}px wide`
    ).toBeLessThan(b.w);
  }

  // The page must not scroll sideways with the forms open either.
  const doc = (await page.evaluate(
    "({w: document.documentElement.scrollWidth, v: document.documentElement.clientWidth})"
  )) as { w: number; v: number };
  expect(doc.w, "the page scrolls sideways").toBeLessThanOrEqual(doc.v);
});
