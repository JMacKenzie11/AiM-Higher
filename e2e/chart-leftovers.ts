import { expect } from "./fixtures";
import type { Page } from "@playwright/test";

// FUNCTIONS THE CHART SPECS LEFT BEHIND ON BENSON.
//
// chart-add-function and chart-function-drawer each create a throwaway
// function ("E2E add <n>", "E2E move <n>") and delete it as their last
// step. A run that fails before that step leaves it on Benson's chart
// for good, and every later run then measures and drags a chart that
// is wider than Benson's. On 2026-09-29 dev held four of them: the
// chart was fitted to a phone at 0.107 scale, and chart-fit failed on
// "97px of empty canvas" against a chart that was only three
// leftovers too wide.
//
// So the specs that create one clear their prefix first, and
// chart-fit, which measures Benson's real chart, clears both before it
// measures. Through the UI, the same way the specs delete their own,
// and only these two prefixes: nothing a company made is touched.
//
// Expects the page scoped into Benson.
const LEFTOVER = /E2E (add|move) \d{13}/;

export async function clearChartLeftovers(page: Page): Promise<number> {
  let removed = 0;
  for (let i = 0; i < 12; i += 1) {
    await page.goto("/chart");
    await expect(page.getByTestId("add-function-button")).toBeVisible({ timeout: 30_000 });
    const card = page.getByTestId("function-card-button").filter({ hasText: LEFTOVER }).first();
    if ((await card.count()) === 0) return removed;
    await card.click();
    const panel = page
      .getByTestId("drawer-panel")
      .and(page.locator('[data-drawer-name="chart-function"]'));
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByRole("button", { name: /delete function/i }).click();
    await page.getByTestId("confirm-accept").click();
    await expect(panel).toBeHidden({ timeout: 30_000 });
    removed += 1;
  }
  throw new Error("more than 12 leftover E2E functions on Benson; clear them by hand");
}
