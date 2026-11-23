import { test, expect, signIn, users } from "./fixtures";

// Upload a transcript on Meeting Summaries (2026-11-13). The card is
// offered to the company admin and not to a team member; the unit
// tests pin the action's rule and the row it writes.
//
// Nothing is uploaded here: a real upload runs a full model analysis.
// A file is chosen to show the button turning on, and never submitted.

test("a company admin sees Upload a transcript; Analyse waits for a file", async ({ page }) => {
  await signIn(page, users.companyAdmin());
  await page.goto("/leadership");
  const card = page.getByRole("region", { name: "Upload a transcript" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByLabel("Held on")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  const analyse = card.getByRole("button", { name: "Analyse meeting" });
  await expect(analyse).toBeDisabled();
  await card.locator('input[type="file"]').setInputFiles({
    name: "weekly.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Weekly leadership meeting"),
  });
  await expect(card.getByText("weekly.txt")).toBeVisible();
  await expect(analyse).toBeEnabled();
});

// The AiMS champion could upload too until the seat was retired (0329).
test("a team member doesn't see it", async ({ page }) => {
  await signIn(page, users.lead());
  await page.goto("/leadership");
  await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Upload a transcript" })).toHaveCount(0);
});
