import { test, expect, signIn, users } from "./fixtures";

// Workers, the browser prototype (0303), end to end and for real: a
// system admin creates a worker, gives it a task on Holabird Sports,
// and the worker does it in a Browserbase browser with Claude choosing
// each step. Tolerant about the words and strict about the record: the
// task finishes, steps were written, the reply carries prices, and the
// home page's Activity shows it. Then the worker is archived, since
// nothing here is deleted.
//
// Needs BROWSERBASE_API_KEY and ANTHROPIC_API_KEY on the dev server,
// and costs about 10 cents a run.
//
// A company admin gets the not-found page: workers are system admins'.

test.describe("Workers", () => {
  test("a worker does a task in the browser and reports back", async ({ page }) => {
    test.setTimeout(330_000);
    const name = `E2E Shoe checker ${Date.now()}`;

    await signIn(page, users.admin());
    await page.goto("/workers");
    await expect(page.getByRole("heading", { name: "Workers", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "New worker" }).click();
    await expect(page).toHaveURL(/\/workers\/new$/, { timeout: 15_000 });
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByRole("button", { name: "Create worker" }).click();
    await expect(page).toHaveURL(/\/workers\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    await page
      .getByLabel("What should it do?")
      .fill("Search holabirdsports.com for running shoes and give me the name and price of the first 3 results.");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page).toHaveURL(/\/workers\/[0-9a-f-]{36}\/runs\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByText("The browser, live")).toBeVisible({ timeout: 15_000 });

    // It works in the background and the page looks again by itself.
    await expect(page.getByRole("heading", { name: "What it found" })).toBeVisible({ timeout: 300_000 });
    const reply = await page.locator("section", { has: page.getByRole("heading", { name: "What it found" }) }).innerText();
    expect(reply, "the reply carries prices").toMatch(/\$\d+/);
    await expect(page.getByText(/^\d+ steps$/)).toBeVisible();
    await expect(page.getByText("Opened", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Replay on Browserbase" })).toBeVisible();

    await page.goto("/workers");
    const activity = page.locator("section", { has: page.getByRole("heading", { name: "Activity" }) });
    await expect(activity.getByRole("link", { name }).first()).toBeVisible();
    await expect(activity.getByText("Finished").first()).toBeVisible();

    await page.getByRole("link", { name }).last().click();
    await page.getByRole("button", { name: "Archive worker" }).click();
    await expect(page).toHaveURL(/\/workers$/, { timeout: 15_000 });
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Your workers" }) }).getByRole("link", { name })).toHaveCount(0);
  });

  test("a company admin does not get workers", async ({ page }) => {
    await signIn(page, users.companyAdmin());
    const res = await page.goto("/workers");
    expect(res?.status() === 404 || (await page.getByText(/not found|could not be found|doesn.t exist/i).count()) > 0 || !page.url().includes("/workers")).toBe(true);
    await expect(page.getByRole("link", { name: "New worker" })).toHaveCount(0);
  });
});
