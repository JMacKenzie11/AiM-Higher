import { test, expect, signIn, users } from "./fixtures";

// Upload a transcript on Meeting Summaries (2026-11-13). The card is
// offered to the company admin and not to a team member who isn't the
// champion; the unit tests pin the action's rule and the row it writes.
//
// Nothing is uploaded here: a real upload runs a full model analysis.
// The submit below is empty on purpose and is refused before any write.

test("a company admin sees Upload a transcript; an empty one is refused", async ({ page }) => {
  // The first submit compiles the action on a cold dev server.
  test.setTimeout(180_000);
  await signIn(page, users.companyAdmin());
  await page.goto("/leadership");
  const card = page.getByRole("region", { name: "Upload a transcript" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByLabel("Held on")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await card.getByRole("button", { name: "Analyse meeting" }).click();
  await expect(card.getByText("Choose a transcript file first.")).toBeVisible({ timeout: 150_000 });
});

// users.member() is the fixture company's AiMS champion
// (guide-champion.spec.ts), so it is offered the card. The function
// lead is a team member who holds no seat.
test("the champion sees it", async ({ page }) => {
  await signIn(page, users.member());
  await page.goto("/leadership");
  await expect(page.getByRole("region", { name: "Upload a transcript" })).toBeVisible({ timeout: 30_000 });
});

test("a team member who isn't the champion doesn't see it", async ({ page }) => {
  await signIn(page, users.lead());
  await page.goto("/leadership");
  await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Upload a transcript" })).toHaveCount(0);
});
