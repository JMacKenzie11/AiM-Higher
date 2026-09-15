import { test, expect, signIn, users } from "./fixtures";

test("does adding a CSF refresh the list", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page.getByTestId("scope-into-company").filter({ hasText: /^AiMS Construction Group$/ }).click();
  await expect(page).not.toHaveURL(/\/admin\/companies/, { timeout: 30_000 });

  await page.goto("/measures");
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: /\+ Add a critical success factor/i }).first().click();
  await page.getByLabel("New critical success factor").first().fill("ZZ temp pencil check");
  await page.getByRole("button", { name: /^Add$/ }).first().click();
  await page.waitForTimeout(8000);
  console.log("edit icons WITHOUT reload:", await page.getByRole("button", { name: /^Edit this/ }).count());

  await page.reload();
  await page.waitForTimeout(4000);
  console.log("edit icons AFTER reload:", await page.getByRole("button", { name: /^Edit this/ }).count());
  console.log("text Edit buttons remaining:", await page.getByRole("button", { name: /^Edit$/ }).count());

  const editIcon = page.getByRole("button", { name: /^Edit this/ }).first();
  if (await editIcon.count()) {
    const row = editIcon.locator("xpath=../..");
    await row.screenshot({ path: "docs/screenshots/measures-edit-pencil.png" });
    await editIcon.hover();
    await page.waitForTimeout(600);
    await row.screenshot({ path: "docs/screenshots/measures-edit-pencil-hover.png" });
  }
});
