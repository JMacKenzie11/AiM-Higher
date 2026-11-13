import { test, expect, signIn, users } from "./fixtures";

// Upload a transcript on Meeting Summaries (2026-11-13). The card is
// offered to the company admin and not to a team member who isn't the
// champion; the unit tests pin the action's rule and the row it writes.
//
// Nothing is uploaded here: a real upload runs a full model analysis.
// The submit below is empty on purpose and is refused before any write.

test("a company admin sees Upload a transcript; an empty one is refused", async ({ page }) => {
  await signIn(page, users.companyAdmin());
  await page.goto("/leadership");
  const card = page.getByRole("region", { name: "Upload a transcript" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByLabel("Held on")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await card.getByRole("button", { name: "Analyse meeting" }).click();
  await expect(card.getByText("Upload a transcript or paste one in.")).toBeVisible({ timeout: 30_000 });
});

test("a team member who isn't the champion doesn't see it", async ({ page }) => {
  await signIn(page, users.member());
  await page.goto("/leadership");
  await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Upload a transcript" })).toHaveCount(0);
});
