import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// A system admin has no company of their own, so coaching needs a
// scope. Without it both branches render the friendly "Couldn't
// start that chat" page — which is correct, and not what this spec
// is about.
async function scopeIn(page: Page) {
  await page.goto("/hq");
  await page.getByTestId("scope-into-company").first().click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

// /ask-aimee/new with NO query parameters.
//
// It 500'd on every visit: the page called a server action during
// render, and that action ends in revalidatePath, which Next forbids
// mid-render. The ?agent= branch was unaffected, which is why the
// picker worked and a bare link did not.
test.describe("starting a conversation from the URL", () => {
  test("lands in a chat rather than an error", async ({ page }) => {
    await signIn(page, users.admin());
    await scopeIn(page);
    // No status assertion on this one: the route redirects, and
    // racing goto's response against the redirect produced
    // ERR_ABORTED rather than a verdict. Landing in a chat is the
    // stronger claim anyway — a 500 renders the error boundary and
    // never reaches a conversation URL.
    // waitUntil "commit": the route redirects as part of rendering,
    // and waiting for load raced the redirect into ERR_ABORTED.
    await page.goto("/ask-aimee/new", { waitUntil: "commit" });

    // It creates a conversation and redirects into it.
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("still works with an agent named", async ({ page }) => {
    // The branch that was never broken. A control: a fix that moved
    // the breakage rather than removing it would show up here.
    await signIn(page, users.admin());
    await scopeIn(page);
    await page.goto("/ask-aimee/new?agent=ask-better-questions");
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
  });
});
