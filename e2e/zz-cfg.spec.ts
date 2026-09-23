import { test, expect, signIn, users, chooseRowAction } from "./fixtures";
const panel = (p: import("@playwright/test").Page, n: string) =>
  p.getByTestId("drawer-panel").and(p.locator(`[data-drawer-name="${n}"]`));

test("config drawer opens", async ({ page }) => {
  await signIn(page, users.admin());
  await page.goto("/admin/agents");
  const row = page.locator('[data-agent-slug="ask-better-questions"]');
  await chooseRowAction(row, /^config$/i);
  const d = panel(page, "agent-config");
  await expect(d).toBeVisible();
  await expect(d.getByTestId("agent-config-source")).toContainText(
    /code default/i,
    { timeout: 15_000 }
  );
  await d.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await page.screenshot({ path: "/tmp/p2shots/config-readonly.png" });
});
