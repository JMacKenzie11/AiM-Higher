import { test, expect, signIn, users } from "./fixtures";

// THE CLARITY CHECK IS NOT PART OF THE ROW.
//
// It used to render inline as a direct child of `.row`, the grid
// whose cells are placed by child position — the same grid, and the
// same hazard, as failure mode E15. On a phone it roughly doubled
// the height of the card it belonged to, so the list you were
// working down reflowed under your thumb every time you scored one
// commitment.
//
// What this pins is not the animation. It is that opening the panel
// leaves the row exactly the height it was, and that the panel is a
// child of <body> rather than of the row — which is also what keeps
// `position: fixed` resolving against the viewport instead of
// against whichever ancestor happens to carry a transform.
//
// At iPhone width, because that is the case that was bad.


test("clarity opens as a drawer, not inside the row", async ({ page }) => {
  const dead: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/_next/")) dead.push(r.url());
  });

  await page.setViewportSize({ width: 393, height: 852 });
  await signIn(page, users.admin());

  // Sign-in leaves the page on "/" with a redirect to the role's home
  // still queued; it fires the moment anything else navigates and
  // cancels it. Let the first goto be the one it eats. See E15.
  for (let i = 0; i < 4; i++) {
    try {
      await page.goto("/admin/companies", { waitUntil: "networkidle" });
    } catch {
      await page.waitForTimeout(1500);
      continue;
    }
    if (new URL(page.url()).pathname === "/admin/companies") break;
    await page.waitForTimeout(1500);
  }
  await page.getByTestId("scope-into-company").filter({ hasText: /^Benson Seafood$/ }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 90_000 });

  await page.goto("/commitments", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  expect(new URL(page.url()).pathname).toBe("/commitments");
  expect(dead, "app assets failed to load").toEqual([]);

  const dot = page.locator('button[aria-label*="clarity" i], button[aria-label*="Clear —" i], button[aria-label*="Unclear" i]').first();
  await expect(dot).toBeVisible({ timeout: 30_000 });

  const rowHeightBefore = (await page.evaluate(`(() => {
    const b = document.querySelector('button[aria-label*="clarity"], button[aria-label*="Clear —"], button[aria-label*="Unclear"]');
    const row = b.closest('[class*="row"]');
    return Math.round(row.getBoundingClientRect().height);
  })()`)) as number;

  await dot.click();
  const panel = page.getByRole("dialog", { name: /clarity check/i });
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // It finished sliding, and it is a full-height right-hand panel.
  await expect.poll(async () => {
    const b = await panel.boundingBox();
    return b ? Math.round(b.x) : -1;
  }, { timeout: 10_000 }).toBeLessThan(5);

  type Info = {
    parentIsBody: boolean;
    insideRow: boolean;
    panelH: number;
    viewportH: number;
    rowH: number;
    docW: number;
    viewW: number;
    quote: string | null;
  };
  const info = (await page.evaluate(`(() => {
    const p = document.querySelector('[role="dialog"][aria-modal="true"]');
    const b = document.querySelector('button[aria-label*="clarity"], button[aria-label*="Clear —"], button[aria-label*="Unclear"]');
    const row = b.closest('[class*="row"]');
    return {
      parentIsBody: p.parentElement === document.body,
      insideRow: row.contains(p),
      panelH: Math.round(p.getBoundingClientRect().height),
      viewportH: window.innerHeight,
      rowH: Math.round(row.getBoundingClientRect().height),
      docW: document.documentElement.scrollWidth,
      viewW: document.documentElement.clientWidth,
      quote: p.querySelector('[class*="drawerQuote"]')?.textContent?.slice(0, 50) ?? null,
    };
  })()`)) as Info;
  console.log("DRAWER", JSON.stringify(info, null, 1), "rowBefore=", rowHeightBefore);

  expect(info.parentIsBody, "must portal to body").toBe(true);
  expect(info.insideRow, "must not be inside the row").toBe(false);
  expect(info.rowH, "the row must not have grown").toBe(rowHeightBefore);
  expect(info.docW, "must not scroll sideways").toBeLessThanOrEqual(info.viewW);
  expect(info.quote, "must show the commitment it is scoring").not.toBeNull();

  // THE FOOTER BUTTONS CLEAR THE HELP WIDGET.
  //
  // It is fixed to the bottom-right corner at z-index 100 — above
  // this panel's 61, and above every other drawer and dialog in the
  // app. Right-aligned, the round "?" sat on top of Close and
  // covered half its label.
  const overlap = (await page.evaluate(`(() => {
    const help = document.querySelector('button[aria-label="Open help"], button[aria-label="Close help"]');
    if (!help) return "no help widget on the page";
    const h = help.getBoundingClientRect();
    const panel = document.querySelector('[role="dialog"][aria-modal="true"]');
    const hit = [];
    for (const b of Array.from(panel.querySelectorAll("button"))) {
      const r = b.getBoundingClientRect();
      if (r.width === 0) continue;
      const clash =
        r.left < h.right && r.right > h.left &&
        r.top < h.bottom && r.bottom > h.top;
      if (clash) hit.push((b.textContent || "").trim() || b.getAttribute("aria-label"));
    }
    return hit;
  })()`)) as string[] | string;
  console.log("HELP OVERLAP", JSON.stringify(overlap));
  expect(overlap, "drawer buttons sit under the help widget").toEqual([]);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });
});
