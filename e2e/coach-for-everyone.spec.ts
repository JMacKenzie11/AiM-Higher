import { test, expect, signIn, users } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

// The Coach button for everyone (0261, open data phase E).
//
// The fixture team member manages nobody, and the fixture function lead
// does not report to them: before 0261 the member saw no Coach button
// on the lead's row and was refused at every layer. Now the button is
// on every row but their own, and it starts a conversation.
//
// Writes on E2E Fixture Co only: one coaching conversation, deleted at
// the end.

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

test.describe("Coach for everyone", () => {
  let conversationId: string | null = null;

  test.afterAll(async () => {
    if (conversationId) await db().from("coaching_conversations").delete().eq("id", conversationId);
  });

  test("a team member coaches about a colleague, and never about themselves", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/people");

    const ownRow = page.locator("tr", { hasText: "E2E Team Member" }).first();
    await expect(ownRow, "the fixture team member is not on /people; reseed with npm run seed:e2e").toBeVisible({
      timeout: 30_000,
    });
    await expect(ownRow.getByRole("link", { name: /^coach$/i })).toHaveCount(0);

    const colleagueRow = page.locator("tr", { hasText: "E2E Function Lead" }).first();
    await colleagueRow.getByRole("link", { name: /^coach$/i }).click();
    await expect(page).toHaveURL(/\/coach\/[0-9a-f-]{36}$/, { timeout: 30_000 });

    await page.getByRole("button", { name: /new conversation/i }).click();
    await expect(page).toHaveURL(/\/coach\/[0-9a-f-]{36}\/[0-9a-f-]{36}/, { timeout: 30_000 });
    conversationId = page.url().split("/").pop() ?? null;
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
