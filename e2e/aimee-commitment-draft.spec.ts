import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Aimee drafts the leader's next step as a commitment, and the leader
// saves it (coaching principles, part 3; 0255).
//
// Tolerant about the prose and strict about the record, like the other
// conversation specs: the assertions are that a draft card appears
// once they say yes, that nothing is saved until they press Save, that
// it saves once as their own commitment due "By next meeting", and that
// a reload shows it saved rather than offering Save again.

const MARKER = `E2E draft ${Date.now()}`;

async function sendIn(page: Page, text: string) {
  const bubbles = page.getByTestId("coach-bubble");
  const before = await bubbles.count();
  const composer = page.getByPlaceholder("Ask Aimee…");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(bubbles).toHaveCount(before + 2, { timeout: 180_000 });
  await expect(composer).toBeEnabled({ timeout: 180_000 });
}

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function savedRows() {
  const { data, error } = await db()
    .from("commitments")
    .select("id, owner_id, due_date_defaulted, coaching_message_id")
    .eq("description", MARKER);
  if (error) throw new Error(`reading commitments: ${error.message}`);
  return data ?? [];
}

test.describe("Aimee's commitment draft", () => {
  test.describe.configure({ timeout: 480_000 });

  test.afterEach(async ({ page }) => {
    // The fixture keeps no commitment and no memory from this test.
    const { error } = await db().from("commitments").delete().eq("description", MARKER);
    if (error) throw new Error(`commitment cleanup FAILED: ${error.message}`);
    const outcome = await page
      .evaluate(async () => {
        const res = await fetch("/api/coach/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        });
        return { status: res.status, body: await res.text() };
      })
      .catch((err) => ({ status: 0, body: String(err) }));
    if (outcome.status !== 200) throw new Error(`coach_memories cleanup FAILED: ${outcome.body}`);
  });

  test("the leader says yes, sees the draft, and saves it once as their own", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/ask-aimee");
    await page.getByRole("button", { name: /new conversation/i }).first().click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });

    await sendIn(page, "Our weekly meeting went really well yesterday. People disagreed openly about pricing for the first time.");
    await sendIn(page, "I think I'll ask the team at Monday's meeting what made it work.");
    await expect(page.getByTestId("commitment-draft-card"), "a draft before they said yes").toHaveCount(0);
    await sendIn(page, "Yes, please draft that as a commitment.");

    const card = page.getByTestId("commitment-draft-card");
    await expect(card).toHaveCount(1, { timeout: 60_000 });
    await expect(card.getByText("By next meeting")).toBeVisible();
    expect(await savedRows(), "saved before Save was pressed").toEqual([]);

    await card.getByLabel("What you’ll do").fill(MARKER);
    await card.getByRole("button", { name: "Save commitment" }).click();
    await expect(card.getByText("Saved to your commitments.")).toBeVisible({ timeout: 30_000 });

    const rows = await savedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].due_date_defaulted).toBe(true);
    expect(rows[0].coaching_message_id).toMatch(/^[0-9a-f-]{36}$/);

    // Reloaded, the card is saved, with no Save to press twice.
    await page.reload();
    const again = page.getByTestId("commitment-draft-card");
    await expect(again.getByText("Saved to your commitments.")).toBeVisible({ timeout: 30_000 });
    await expect(again.getByRole("button", { name: "Save commitment" })).toHaveCount(0);
    expect(await savedRows()).toHaveLength(1);

    await page.goto("/commitments");
    await expect(page.getByText(MARKER).first()).toBeVisible({ timeout: 30_000 });
  });
});
